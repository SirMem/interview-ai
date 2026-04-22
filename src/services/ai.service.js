import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { addCounter } from '../utils/telemetry.js';

dotenv.config();
const log = logger('AIService');

// ── AI pricing table ─────────────────────────────────────────────────────────
// USD per 1M tokens, last updated 2026-04-22. Update when providers change pricing.
// Unknown models log a one-time warning and record cost as 0 (tokens still tracked).
// Use "<provider>:*" as a fallback prefix (e.g. "ollama:*") for $0 local models.
const AI_PRICING = {
  // OpenAI
  'gpt-4o':                       { in: 2.50,  out: 10.00 },
  'gpt-4o-mini':                  { in: 0.15,  out: 0.60 },
  'gpt-4-turbo':                  { in: 10.00, out: 30.00 },
  'gpt-3.5-turbo':                { in: 0.50,  out: 1.50 },
  'o1':                           { in: 15.00, out: 60.00 },
  'o1-mini':                      { in: 1.10,  out: 4.40 },
  // Groq
  'llama-3.3-70b-versatile':      { in: 0.59,  out: 0.79 },
  'llama-3.1-8b-instant':         { in: 0.05,  out: 0.08 },
  'mixtral-8x7b-32768':           { in: 0.24,  out: 0.24 },
  'gemma2-9b-it':                 { in: 0.20,  out: 0.20 },
  // Gemini
  'gemini-2.5-flash':             { in: 0.075, out: 0.30 },
  'gemini-2.5-pro':               { in: 1.25,  out: 10.00 },
  'gemini-1.5-flash':             { in: 0.075, out: 0.30 },
  'gemini-1.5-pro':               { in: 1.25,  out: 5.00 },
  // Anthropic
  'claude-sonnet-4-5':            { in: 3.00,  out: 15.00 },
  'claude-haiku-4-5':             { in: 1.00,  out: 5.00 },
  'claude-opus-4-7':              { in: 15.00, out: 75.00 },
  'claude-3-5-sonnet-20241022':   { in: 3.00,  out: 15.00 },
  'claude-3-5-haiku-20241022':    { in: 0.80,  out: 4.00 },
  // Local — Ollama models cost $0 (electricity not modeled)
  'ollama:*':                     { in: 0,     out: 0 },
};
const _unknownModelWarned = new Set();
function _priceFor(model) {
  if (!model) return null;
  if (AI_PRICING[model]) return AI_PRICING[model];
  // Fallback by family prefix (e.g. "ollama:llama3.2:1b" → "ollama:*")
  for (const key of Object.keys(AI_PRICING)) {
    if (key.endsWith(':*') && model.startsWith(key.slice(0, -1))) return AI_PRICING[key];
  }
  return null;
}
function _costFor(model, inTokens, outTokens) {
  const p = _priceFor(model);
  if (!p) {
    if (model && !_unknownModelWarned.has(model)) {
      _unknownModelWarned.add(model);
      log.warn(`AI pricing unknown for model "${model}" — cost recorded as 0. Add to AI_PRICING.`);
    }
    return 0;
  }
  return ((inTokens || 0) * p.in + (outTokens || 0) * p.out) / 1_000_000;
}

const CONFIG_FILE_PATH = path.join(process.cwd(), 'config', 'api-keys.json');

const PROMPT_FILE_MAP = {
  system: 'system-prompt.txt',
  context: 'context-prompt.txt',
  transcription: 'transcription-prompt.txt',
  debug: 'debug-prompt.txt',
  coding: 'coding-prompt.txt',
  theory: 'theory-prompt.txt',
  'interview-answer': 'interview-answer-prompt.txt',
};

// Default models per provider (used if not set in config)
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  grok: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-5',
};

class AIService {
  constructor() {
    this.config = null;
    this.loadConfig();

    // Track failed providers: { providerId -> { failedAt, failures } }
    this.failedProviders = new Map();

    // Cache for prompt file contents — loaded at startup, refreshed via fs.watch
    this._promptCache = new Map();
    this._loadAllPrompts();

    // Watch config file and prompts directory for changes
    this._watchConfig();
    this._watchPrompts();
  }

  // ==================== Config Management ====================

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const configData = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        this.config = JSON.parse(configData);
      } else {
        this.config = { keys: {}, order: [], models: {} };
        if (process.env.OPENAI_API_KEY) {
          this.config.keys.openai = process.env.OPENAI_API_KEY;
          this.config.order.push('openai');
        }
        if (process.env.GROQ_API_KEY) {
          this.config.keys.grok = process.env.GROQ_API_KEY;
          this.config.order.push('grok');
        }
        if (process.env.GEMINI_API_KEY) {
          this.config.keys.gemini = process.env.GEMINI_API_KEY;
          this.config.order.push('gemini');
        }
        if (process.env.ANTHROPIC_API_KEY) {
          this.config.keys.claude = process.env.ANTHROPIC_API_KEY;
          this.config.order.push('claude');
        }
      }
    } catch (err) {
      log.error('Error loading AI config', err);
      this.config = { keys: {}, order: [], models: {} };
    }
  }

  _watchConfig() {
    let debounceTimer = null;
    try {
      const dir = path.dirname(CONFIG_FILE_PATH);
      const filename = path.basename(CONFIG_FILE_PATH);
      if (fs.existsSync(dir)) {
        fs.watch(dir, (event, changedFile) => {
          if (changedFile === filename) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              this.loadConfig();
              log.info('Config reloaded due to file change');
            }, 150);
          }
        });
      }
    } catch (err) {
      log.warn('Could not watch config file for changes', { error: err.message });
    }
  }

  // ==================== Model Resolution ====================

  _getModel(providerId) {
    return this.config?.models?.[providerId] || DEFAULT_MODELS[providerId] || undefined;
  }

  // o1/o3/o4-series models use max_completion_tokens and don't support temperature
  _isOModel(model) {
    return /^o\d/.test(model || '');
  }

  _openAIParams(model, messages, options, stream = false) {
    const base = { model, messages };
    if (stream) {
      base.stream = true;
      // Required for token usage to appear in the final stream chunk.
      base.stream_options = { include_usage: true };
    }
    if (this._isOModel(model)) {
      base.max_completion_tokens = options.max_tokens || 2048;
    } else {
      base.temperature = options.temperature || 0.7;
      base.max_tokens = options.max_tokens || 2048;
    }
    return base;
  }

  // ==================== Prompt Cache ====================

  _loadAllPrompts() {
    const promptsDir = path.join(process.cwd(), 'prompts');
    for (const [type, filename] of Object.entries(PROMPT_FILE_MAP)) {
      try {
        const promptPath = path.join(promptsDir, filename);
        const content = fs.readFileSync(promptPath, 'utf8').trim();
        this._promptCache.set(type, content);
      } catch (err) {
        log.warn(`Could not load prompt file for type: ${type}`);
      }
    }
    log.info(`Prompt cache loaded (${this._promptCache.size} prompts)`);
  }

  _watchPrompts() {
    let debounceTimer = null;
    try {
      const promptsDir = path.join(process.cwd(), 'prompts');
      if (fs.existsSync(promptsDir)) {
        fs.watch(promptsDir, () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this._loadAllPrompts();
            log.info('Prompt cache refreshed due to file change');
          }, 150);
        });
      }
    } catch (err) {
      log.warn('Could not watch prompts directory', { error: err.message });
    }
  }

  readPromptFromFile(promptType = 'system') {
    const cached = this._promptCache.get(promptType);
    if (cached) return cached;
    log.warn(`Prompt type "${promptType}" not in cache, using default`);
    return 'Analyze this screenshot text and provide insights';
  }

  readContextPromptFromFile(context, promptType = 'context') {
    const cached = this._promptCache.get(promptType);
    if (cached) {
      return cached.replace('{CONTEXT}', context || 'No previous context available');
    }
    log.warn(`Context prompt type "${promptType}" not in cache, using default`);
    return `Previous context:\n${context}\n\nAnalyze this screenshot text and provide insights`;
  }

  readTranscriptionPromptFromFile(promptType = 'transcription') {
    const cached = this._promptCache.get(promptType);
    if (cached) return cached;
    log.warn(`Transcription prompt type "${promptType}" not in cache, using default`);
    return 'Identify the coding interview question from this transcription and provide a complete solution.';
  }

  /**
   * Build role-context prefix if interview_role is configured.
   * Prepended to system prompts so AI tailors answers for that domain.
   */
  _getRolePrefix() {
    const role = this.config?.interview_role?.trim();
    if (!role) return '';
    return `## Interview Context\nRole: ${role}\nTailor your answer specifically for a ${role} interview — use relevant tools, frameworks, and terminology for this domain.\n\n`;
  }

  // ==================== Provider Failure Tracking (exponential backoff) ====================

  _getBackoffMs(failures) {
    return Math.min(30_000 * Math.pow(2, failures - 1), 600_000);
  }

  markProviderAsFailed(providerId) {
    const existing = this.failedProviders.get(providerId);
    const failures = existing ? existing.failures + 1 : 1;
    this.failedProviders.set(providerId, { failedAt: Date.now(), failures });
    const backoffSec = Math.round(this._getBackoffMs(failures) / 1000);
    log.warn(`Marked ${providerId} as failed`, { failures, retryInSec: backoffSec });
  }

  markProviderAsSuccess(providerId) {
    if (this.failedProviders.has(providerId)) {
      this.failedProviders.delete(providerId);
      log.info(`${providerId} recovered — removed from failed list`);
    }
  }

  getAvailableProviders() {
    if (!this.config) return [];

    const enabledProviders = this.config.enabled || [];
    const providersToUse =
      enabledProviders.length > 0
        ? enabledProviders
        : (this.config.order || []).filter((id) => {
            const key = this.config.keys[id];
            return key && key.trim().length > 0;
          });

    const availableProviders = providersToUse.filter((id) => {
      const key = this.config.keys[id];
      return key && key.trim().length > 0;
    });

    const now = Date.now();
    return availableProviders.filter((providerId) => {
      const entry = this.failedProviders.get(providerId);
      if (!entry) return true;

      const { failedAt, failures } = entry;
      const backoff = this._getBackoffMs(failures);
      if (now - failedAt >= backoff) {
        this.failedProviders.delete(providerId);
        log.info(`Retrying ${providerId} after backoff`, {
          failures,
          elapsed: `${Math.round((now - failedAt) / 1000)}s`,
        });
        return true;
      }
      return false;
    });
  }

  // ==================== Non-streaming AI calls ====================

  // Non-streaming calls return { text, model, usage: { input_tokens, output_tokens } }.
  // Callers that only need text use `.text`; callers that want telemetry use `.usage`.

  async callOpenAI(messages, options = {}) {
    const apiKey = this.config?.keys?.openai;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const openai = new OpenAI({ apiKey });
    const model = options.model || this._getModel('openai');
    const completion = await openai.chat.completions.create(
      this._openAIParams(model, messages, options),
    );
    return {
      text:  completion.choices[0]?.message?.content || 'No response generated',
      model,
      usage: {
        input_tokens:  completion.usage?.prompt_tokens     || 0,
        output_tokens: completion.usage?.completion_tokens || 0,
      },
    };
  }

  async callGrok(messages, options = {}) {
    const apiKey = this.config?.keys?.grok;
    if (!apiKey) throw new Error('Grok API key not configured');
    const groq = new Groq({ apiKey });
    const model = options.model || this._getModel('grok');
    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
    });
    return {
      text:  completion.choices[0]?.message?.content || 'No response generated',
      model,
      usage: {
        input_tokens:  completion.usage?.prompt_tokens     || 0,
        output_tokens: completion.usage?.completion_tokens || 0,
      },
    };
  }

  async callGemini(messages, options = {}) {
    const apiKey = this.config?.keys?.gemini;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = options.model || this._getModel('gemini');
    const model = genAI.getGenerativeModel({ model: modelName });
    const userMessage = messages.find((m) => m.role === 'user')?.content || '';
    const systemMessage = messages.find((m) => m.role === 'system')?.content || '';
    const prompt = systemMessage ? `${systemMessage}\n\n${userMessage}` : userMessage;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return {
      text:  response.text() || 'No response generated',
      model: modelName,
      usage: {
        input_tokens:  response.usageMetadata?.promptTokenCount     || 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  async callClaude(messages, options = {}) {
    const apiKey = this.config?.keys?.claude;
    if (!apiKey) throw new Error('Claude API key not configured');
    const client = new Anthropic({ apiKey });

    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const userMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const systemBlock = systemMsg
      ? [{ type: 'text', text: systemMsg, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const model = options.model || this._getModel('claude');
    const response = await client.messages.create({
      model,
      max_tokens: options.max_tokens || 2048,
      system: systemBlock,
      messages: userMessages.length > 0 ? userMessages : [{ role: 'user', content: 'Hello' }],
    });
    return {
      text:  response.content[0]?.text || 'No response generated',
      model,
      usage: {
        input_tokens:                response.usage?.input_tokens                 || 0,
        output_tokens:               response.usage?.output_tokens                || 0,
        cache_read_input_tokens:     response.usage?.cache_read_input_tokens      || 0,
        cache_creation_input_tokens: response.usage?.cache_creation_input_tokens  || 0,
      },
    };
  }

  async callAIWithFallback(messages, options = {}) {
    const providers = this.getAvailableProviders();

    if (providers.length === 0) {
      const allProviders = (
        this.config?.enabled || this.config?.order || []
      ).filter((id) => this.config?.keys?.[id]?.trim());

      if (allProviders.length > 0 && this.failedProviders.size > 0) {
        const now = Date.now();
        const failedList = Array.from(this.failedProviders.entries())
          .map(([id, { failedAt, failures }]) => {
            const backoff = this._getBackoffMs(failures);
            const timeLeft = Math.ceil((backoff - (now - failedAt)) / 1000);
            return `${id} (retry in ${timeLeft}s)`;
          })
          .join(', ');
        throw new Error(`All AI providers temporarily unavailable: ${failedList}`);
      }
      throw new Error('No AI providers configured. Please configure at least one API key.');
    }

    let lastError = null;
    for (const providerId of providers) {
      try {
        log.debug(`Trying AI provider: ${providerId}`);
        let result;
        switch (providerId) {
          case 'openai':  result = await this.callOpenAI(messages, options); break;
          case 'grok':    result = await this.callGrok(messages, options); break;
          case 'gemini':  result = await this.callGemini(messages, options); break;
          case 'claude':  result = await this.callClaude(messages, options); break;
          default: throw new Error(`Unknown provider: ${providerId}`);
        }
        this.markProviderAsSuccess(providerId);
        log.info(`Success with AI provider: ${providerId}`);
        // Backwards-compat: keep `message.content` field; add provider, model, usage.
        return {
          message:  { content: result.text },
          provider: providerId,
          model:    result.model,
          usage:    result.usage,
        };
      } catch (err) {
        log.warn(`${providerId} failed`, { error: err.message });
        this.markProviderAsFailed(providerId);
        lastError = err;
      }
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  // ==================== Streaming AI calls ====================

  // Streaming generators yield two shapes:
  //   { text: '...' }                          for each content chunk
  //   { usage: { input_tokens, output_tokens } } once at the end
  // Caller is expected to differentiate via `if (chunk.text)` vs `if (chunk.usage)`.

  async *streamOpenAI(messages, options = {}) {
    const apiKey = this.config?.keys?.openai;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const openai = new OpenAI({ apiKey });
    const model = options.model || this._getModel('openai');
    const stream = await openai.chat.completions.create(
      this._openAIParams(model, messages, options, true),
    );
    let usage = null;
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content || '';
      if (text) yield { text };
      if (chunk.usage) usage = chunk.usage;        // final chunk carries usage
    }
    if (usage) yield { usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 } };
  }

  async *streamGrok(messages, options = {}) {
    const apiKey = this.config?.keys?.grok;
    if (!apiKey) throw new Error('Grok API key not configured');
    const groq = new Groq({ apiKey });
    const stream = await groq.chat.completions.create({
      model: options.model || this._getModel('grok'),
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
      stream: true,
      stream_options: { include_usage: true },
    });
    let usage = null;
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content || '';
      if (text) yield { text };
      // Groq surfaces usage in the final chunk's x_groq.usage when stream_options is set
      if (chunk.usage)         usage = chunk.usage;
      else if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
    }
    if (usage) yield { usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 } };
  }

  async *streamGemini(messages, options = {}) {
    const apiKey = this.config?.keys?.gemini;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || this._getModel('gemini'),
    });
    const userMessage   = messages.find((m) => m.role === 'user')?.content   || '';
    const systemMessage = messages.find((m) => m.role === 'system')?.content || '';
    const prompt = systemMessage ? `${systemMessage}\n\n${userMessage}` : userMessage;
    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const text = chunk.text() || '';
      if (text) yield { text };
    }
    // After the stream drains, the aggregate response has usageMetadata.
    try {
      const final = await result.response;
      const um = final.usageMetadata;
      if (um) yield { usage: { input_tokens: um.promptTokenCount || 0, output_tokens: um.candidatesTokenCount || 0 } };
    } catch {}
  }

  async *streamClaude(messages, options = {}) {
    const apiKey = this.config?.keys?.claude;
    if (!apiKey) throw new Error('Claude API key not configured');
    const client = new Anthropic({ apiKey });

    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const userMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    // cache_control marks the system prompt as cacheable (ephemeral, 5-min TTL).
    // Anthropic caches any prefix seen twice within 5 min — ~90% input-token
    // discount + ~100-200ms TTFT improvement on question 2+ in a session.
    // Requires prompt >= 1024 tokens to qualify; smaller prompts are ignored silently.
    const systemBlock = systemMsg
      ? [{ type: 'text', text: systemMsg, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const stream = await client.messages.stream({
      model: options.model || this._getModel('claude'),
      max_tokens: options.max_tokens || 2048,
      system: systemBlock,
      messages: userMessages.length > 0 ? userMessages : [{ role: 'user', content: 'Hello' }],
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    for await (const event of stream) {
      if (event.type === 'message_start' && event.message?.usage) {
        inputTokens         = event.message.usage.input_tokens          || 0;
        cacheReadTokens     = event.message.usage.cache_read_input_tokens     || 0;
        cacheCreationTokens = event.message.usage.cache_creation_input_tokens || 0;
      }
      if (event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text) {
        yield { text: event.delta.text };
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens || 0;
      }
    }
    yield {
      usage: {
        input_tokens:               inputTokens,
        output_tokens:              outputTokens,
        cache_read_input_tokens:    cacheReadTokens,
        cache_creation_input_tokens: cacheCreationTokens,
      },
    };
  }

  /**
   * Streams tokens from the first available provider.
   * Falls back to the next provider if connection fails before any tokens arrive.
   * Yields { token, provider } objects.
   */
  async *callAIWithFallbackStream(messages, options = {}) {
    const providers = this.getAvailableProviders();

    if (providers.length === 0) {
      throw new Error('No AI providers available for streaming.');
    }

    let lastError = null;

    for (const providerId of providers) {
      const model = this.config?.models?.[providerId] || '';
      try {
        let gen;
        switch (providerId) {
          case 'openai': gen = this.streamOpenAI(messages, options); break;
          case 'grok':   gen = this.streamGrok(messages, options); break;
          case 'gemini': gen = this.streamGemini(messages, options); break;
          case 'claude': gen = this.streamClaude(messages, options); break;
          default: throw new Error(`Unknown provider: ${providerId}`);
        }

        // Await the first chunk — surfaces connection/auth errors before we yield.
        const first = await gen.next();

        this.markProviderAsSuccess(providerId);
        addCounter('ai_provider_success_total', 1, { provider: providerId, flow: 'transcription' });
        log.info(`Streaming with provider: ${providerId}`);

        // Inner generator yields { text } for content and { usage } once at the end.
        // Re-yield as the legacy { token, provider, model } shape for content; and
        // a final { usage, provider, model } for the cost/token telemetry consumers.
        if (!first.done && first.value) {
          if (first.value.text) yield { token: first.value.text, provider: providerId, model };
          if (first.value.usage) yield { usage: first.value.usage, provider: providerId, model };
        }
        for await (const chunk of gen) {
          if (chunk.text)  yield { token: chunk.text, provider: providerId, model };
          if (chunk.usage) yield { usage: chunk.usage, provider: providerId, model };
        }

        return;
      } catch (err) {
        log.warn(`${providerId} streaming failed`, { error: err.message });
        this.markProviderAsFailed(providerId);
        addCounter('ai_provider_failure_total', 1, {
          provider:    providerId,
          flow:        'transcription',
          error_class: (err && err.constructor && err.constructor.name) || 'Error',
        });
        lastError = err;
      }
    }

    throw new Error(
      `All AI providers failed for streaming. Last error: ${lastError?.message}`,
    );
  }

  // ==================== High-level API (non-streaming) ====================

  async askGpt(text, promptType = null) {
    const systemPrompt = this.readPromptFromFile(promptType || 'system');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    return await this.callAIWithFallback(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  async askGptWithContext(text, previousResponse, promptType = null) {
    const systemPrompt = this.readContextPromptFromFile(previousResponse, promptType || 'context');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    return await this.callAIWithFallback(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  async askGptQuestion(question) {
    const prompt = `Answer this technical question clearly and comprehensively.

If the question is about programming:
- Provide code examples when relevant
- Explain concepts clearly
- Offer practical solutions
- Include best practices when applicable

If the question is about concepts or theory:
- Explain with clarity and detail
- Use examples to illustrate points
- Break down complex topics

Question: ${question}`;

    const messages = [
      {
        role: 'system',
        content: 'You are a helpful technical assistant specializing in programming and software development. Provide clear, accurate, and practical answers to technical questions.',
      },
      { role: 'user', content: prompt },
    ];
    return await this.callAIWithFallback(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  async askGptTranscription(transcriptionText, promptType = null) {
    const basePrompt = this.readTranscriptionPromptFromFile(promptType || 'transcription');
    const systemPrompt = this._getRolePrefix() + basePrompt;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Live transcription:\n${transcriptionText}` },
    ];
    return await this.callAIWithFallback(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  // ==================== High-level API (streaming) ====================

  async *askGptStream(text, promptType = null) {
    const systemPrompt = this.readPromptFromFile(promptType || 'system');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    yield* this.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  async *askGptTranscriptionStream(transcriptionText, promptType = null) {
    const basePrompt = this.readTranscriptionPromptFromFile(promptType || 'transcription');
    const systemPrompt = this._getRolePrefix() + basePrompt;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Live transcription:\n${transcriptionText}` },
    ];
    yield* this.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  async *askGptWithContextStream(text, previousResponse, promptType = null) {
    const systemPrompt = this.readContextPromptFromFile(previousResponse, promptType || 'context');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    yield* this.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  // ==================== Interview Listener ====================

  async _callOllamaClassifier(messages, modelOverride) {
    const model = modelOverride || this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
    });
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    });
    return completion.choices[0]?.message?.content || '';
  }

  async *_streamOllama(messages, options = {}) {
    const model = options.model || this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' });
    const stream = await openai.chat.completions.create({
      model,
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
      stream: true,
      stream_options: { include_usage: true },
    });
    let usage = null;
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content || '';
      if (text) yield { text };
      if (chunk.usage) usage = chunk.usage;
    }
    if (usage) {
      yield { usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 } };
    } else {
      yield { usage: { input_tokens: 0, output_tokens: 0 } };
    }
  }

  async summarizeQAPair(question, answer) {
    const model = this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' });
    const messages = [
      {
        role: 'system',
        content: 'Summarize this interview Q&A into one concise line (max 40 words). Include the topic and key points covered. No bullet points, no preamble — just the summary line.',
      },
      { role: 'user', content: `Q: ${question}\nA: ${answer}` },
    ];
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 100,
    });
    return completion.choices[0]?.message?.content || '';
  }

  async summarizeMerge(entries) {
    const model = this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' });

    const formatted = entries.map((e, i) => {
      if (e.type === 'merged') return `[${i + 1}] Prior summary: ${e.text}`;
      if (e.summary) return `[${i + 1}] ${e.summary}`;
      return `[${i + 1}] Q: ${e.q}\n    A: ${e.a}`;
    }).join('\n');

    const messages = [
      {
        role: 'system',
        content: 'You are compressing interview conversation history. Merge the following entries into a single concise summary (max 120 words) that preserves topics, key facts, and the chronological flow. No bullet points, no preamble — just the merged summary paragraph.',
      },
      { role: 'user', content: formatted },
    ];
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 250,
    });
    return completion.choices[0]?.message?.content || '';
  }

  setAnswerMode(mode) {
    this._answerMode = mode;
    log.info(`Answer mode set to: ${mode}`);
  }

  async *answerInterviewQuestion(questionText, transcriptContext = '', memoryContext = '') {
    const template = this.readPromptFromFile('interview-answer');
    const rolePrefix = this._getRolePrefix();
    const basePrompt = template
      .replace('{TRANSCRIPT_CONTEXT}', transcriptContext || '(no context yet)')
      .replace('{MEMORY_CONTEXT}', memoryContext ? `## Conversation History\n${memoryContext}` : '');
    const systemPrompt = rolePrefix + basePrompt;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: questionText },
    ];

    const answerMode = this._answerMode || this.config?.answer_mode || 'auto';

    if (answerMode === 'ollama') {
      const ollamaModel = `ollama:${this.config?.ollama_model || 'llama3.2:1b'}`;
      try {
        for await (const chunk of this._streamOllama(messages, { temperature: 0.7, max_tokens: 2048 })) {
          if (chunk.text)  yield { token: chunk.text, provider: 'ollama', model: ollamaModel };
          if (chunk.usage) yield { usage: chunk.usage, provider: 'ollama', model: ollamaModel };
        }
        addCounter('ai_provider_success_total', 1, { provider: 'ollama', flow: 'transcription' });
        return;
      } catch (err) {
        addCounter('ai_provider_failure_total', 1, {
          provider: 'ollama', flow: 'transcription',
          error_class: (err && err.constructor && err.constructor.name) || 'Error',
        });
        log.warn('Ollama answer streaming failed, falling back to remote', { error: err.message });
      }
    } else if (['openai', 'grok', 'gemini', 'claude'].includes(answerMode)) {
      const model = this.config?.models?.[answerMode] || '';
      try {
        const opts = { temperature: 0.7, max_tokens: 2048 };
        let gen;
        switch (answerMode) {
          case 'openai': gen = this.streamOpenAI(messages, opts); break;
          case 'grok':   gen = this.streamGrok(messages, opts); break;
          case 'gemini': gen = this.streamGemini(messages, opts); break;
          case 'claude': gen = this.streamClaude(messages, opts); break;
        }
        for await (const chunk of gen) {
          if (chunk.text)  yield { token: chunk.text, provider: answerMode, model };
          if (chunk.usage) yield { usage: chunk.usage, provider: answerMode, model };
        }
        addCounter('ai_provider_success_total', 1, { provider: answerMode, flow: 'transcription' });
        return;
      } catch (err) {
        addCounter('ai_provider_failure_total', 1, {
          provider: answerMode, flow: 'transcription',
          error_class: (err && err.constructor && err.constructor.name) || 'Error',
        });
        log.warn(`${answerMode} answer streaming failed, falling back`, { error: err.message });
      }
    }

    // 'auto' or fallback
    yield* this.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 });
  }

}

export default new AIService();

// Named export so telemetry consumers (dataHandler / image-processing) can
// price token usage without duplicating the table.
export const aiCostUSD = _costFor;
