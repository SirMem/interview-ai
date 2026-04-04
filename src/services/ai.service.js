import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

dotenv.config();

const log = logger('AIService');

const CONFIG_FILE_PATH = path.join(
  process.cwd(),
  'backend',
  'config',
  'api-keys.json',
);

const PROMPT_FILE_MAP = {
  system: 'system-prompt.txt',
  context: 'context-prompt.txt',
  transcription: 'transcription-prompt.txt',
  debug: 'debug-prompt.txt',
  coding: 'coding-prompt.txt',
  theory: 'theory-prompt.txt',
  'interview-classifier': 'interview-classifier-prompt.txt',
  'interview-answer': 'interview-answer-prompt.txt',
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
        this.config = { keys: {}, order: [] };
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
      }
    } catch (err) {
      log.error('Error loading AI config', err);
      this.config = { keys: {}, order: [] };
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

  // ==================== Provider Failure Tracking (exponential backoff) ====================

  /**
   * Returns the backoff delay in ms for a given failure count.
   * 1 failure → 30s, 2 → 60s, 3 → 120s, 4+ → max 600s
   */
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

  async callOpenAI(messages, options = {}) {
    const apiKey = this.config?.keys?.openai;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: options.model || 'gpt-4o-mini',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
    });
    return completion.choices[0]?.message?.content || 'No response generated';
  }

  async callGrok(messages, options = {}) {
    const apiKey = this.config?.keys?.grok;
    if (!apiKey) throw new Error('Grok API key not configured');
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
    });
    return completion.choices[0]?.message?.content || 'No response generated';
  }

  async callGemini(messages, options = {}) {
    const apiKey = this.config?.keys?.gemini;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || 'gemini-2.5-flash',
    });
    const userMessage = messages.find((m) => m.role === 'user')?.content || '';
    const systemMessage =
      messages.find((m) => m.role === 'system')?.content || '';
    const prompt = systemMessage
      ? `${systemMessage}\n\n${userMessage}`
      : userMessage;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text() || 'No response generated';
  }

  async callAIWithFallback(messages, options = {}) {
    const providers = this.getAvailableProviders();

    if (providers.length === 0) {
      const allProviders = (
        this.config?.enabled ||
        this.config?.order || []
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
        throw new Error(
          `All AI providers temporarily unavailable: ${failedList}`,
        );
      }
      throw new Error(
        'No AI providers configured. Please configure at least one API key.',
      );
    }

    let lastError = null;
    for (const providerId of providers) {
      try {
        log.debug(`Trying AI provider: ${providerId}`);
        let response;
        switch (providerId) {
          case 'openai':
            response = await this.callOpenAI(messages, options);
            break;
          case 'grok':
            response = await this.callGrok(messages, options);
            break;
          case 'gemini':
            response = await this.callGemini(messages, options);
            break;
          default:
            throw new Error(`Unknown provider: ${providerId}`);
        }
        this.markProviderAsSuccess(providerId);
        log.info(`Success with AI provider: ${providerId}`);
        return { message: { content: response }, provider: providerId };
      } catch (err) {
        log.warn(`${providerId} failed`, { error: err.message });
        this.markProviderAsFailed(providerId);
        lastError = err;
      }
    }

    throw new Error(
      `All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`,
    );
  }

  // ==================== Streaming AI calls ====================

  async *streamOpenAI(messages, options = {}) {
    const apiKey = this.config?.keys?.openai;
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const openai = new OpenAI({ apiKey });
    const stream = await openai.chat.completions.create({
      model: options.model || 'gpt-4o-mini',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) yield token;
    }
  }

  async *streamGrok(messages, options = {}) {
    const apiKey = this.config?.keys?.grok;
    if (!apiKey) throw new Error('Grok API key not configured');
    const groq = new Groq({ apiKey });
    const stream = await groq.chat.completions.create({
      model: options.model || 'llama-3.3-70b-versatile',
      messages,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2048,
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) yield token;
    }
  }

  async *streamGemini(messages, options = {}) {
    const apiKey = this.config?.keys?.gemini;
    if (!apiKey) throw new Error('Gemini API key not configured');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || 'gemini-2.5-flash',
    });
    const userMessage = messages.find((m) => m.role === 'user')?.content || '';
    const systemMessage =
      messages.find((m) => m.role === 'system')?.content || '';
    const prompt = systemMessage
      ? `${systemMessage}\n\n${userMessage}`
      : userMessage;
    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const token = chunk.text() || '';
      if (token) yield token;
    }
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
      try {
        let gen;
        switch (providerId) {
          case 'openai':
            gen = this.streamOpenAI(messages, options);
            break;
          case 'grok':
            gen = this.streamGrok(messages, options);
            break;
          case 'gemini':
            gen = this.streamGemini(messages, options);
            break;
          default:
            throw new Error(`Unknown provider: ${providerId}`);
        }

        // Await the first token — surfaces connection/auth errors before we start yielding
        const first = await gen.next();

        // Successfully connected — clear any failure tracking
        this.markProviderAsSuccess(providerId);
        log.info(`Streaming with provider: ${providerId}`);

        if (!first.done && first.value) {
          yield { token: first.value, provider: providerId };
        }

        for await (const token of gen) {
          if (token) yield { token, provider: providerId };
        }

        return; // Done
      } catch (err) {
        log.warn(`${providerId} streaming failed`, { error: err.message });
        this.markProviderAsFailed(providerId);
        lastError = err;
        // Try next provider
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
    return await this.callAIWithFallback(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  async askGptWithContext(text, previousResponse, promptType = null) {
    const systemPrompt = this.readContextPromptFromFile(
      previousResponse,
      promptType || 'context',
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    return await this.callAIWithFallback(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
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
        content:
          'You are a helpful technical assistant specializing in programming and software development. Provide clear, accurate, and practical answers to technical questions.',
      },
      { role: 'user', content: prompt },
    ];
    return await this.callAIWithFallback(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  async askGptTranscription(transcriptionText, promptType = null) {
    const systemPrompt = this.readTranscriptionPromptFromFile(
      promptType || 'transcription',
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Live transcription:\n${transcriptionText}` },
    ];
    return await this.callAIWithFallback(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  // ==================== High-level API (streaming) ====================

  /**
   * Streaming version of askGpt. Yields { token, provider } objects.
   */
  async *askGptStream(text, promptType = null) {
    const systemPrompt = this.readPromptFromFile(promptType || 'system');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    yield* this.callAIWithFallbackStream(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  /**
   * Streaming version of askGptTranscription. Yields { token, provider } objects.
   */
  async *askGptTranscriptionStream(transcriptionText, promptType = null) {
    const systemPrompt = this.readTranscriptionPromptFromFile(
      promptType || 'transcription',
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Live transcription:\n${transcriptionText}` },
    ];
    yield* this.callAIWithFallbackStream(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  /**
   * Streaming version of askGptWithContext. Yields { token, provider } objects.
   */
  async *askGptWithContextStream(text, previousResponse, promptType = null) {
    const systemPrompt = this.readContextPromptFromFile(
      previousResponse,
      promptType || 'context',
    );
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Screenshot text:\n${text}` },
    ];
    yield* this.callAIWithFallbackStream(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }

  // ==================== Interview Listener ====================

  /**
   * Classify using a local Ollama model (OpenAI-compatible API).
   * Returns the raw string content from the model.
   * Throws if Ollama is unreachable.
   */
  async _callOllamaClassifier(messages) {
    const model = this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({
      apiKey: 'ollama',
      baseURL: 'http://localhost:11434/v1',
    });
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 256,           // 120 truncates JSON when questionText is long
      response_format: { type: 'json_object' }, // force valid JSON output
    });
    return completion.choices[0]?.message?.content || '';
  }

  /**
   * Runtime classifier mode: 'ollama' (default) or 'remote'.
   * 'ollama' tries local first, falls back to remote on connection failure.
   * 'remote' always uses the configured remote providers.
   */
  setClassifierMode(mode) {
    if (mode === 'ollama' || mode === 'remote') {
      this._classifierMode = mode;
      log.info(`Classifier mode set to: ${mode}`);
    }
  }

  /**
   * Classify an interviewer utterance as a question (or follow-up).
   * Uses local Ollama by default; falls back to remote if unavailable.
   * Returns { isQuestion, questionText, mergeWithPrevious, confidence }
   */
  async classifyInterviewerUtterance(text, previousQuestionText = '') {
    const template = this.readPromptFromFile('interview-classifier');
    const systemPrompt = template
      .replace('{PREVIOUS_QUESTION}', previousQuestionText || '(none)')
      .replace('{UTTERANCE}', text);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ];

    let raw = '';
    const mode = this._classifierMode || this.config?.classifier_mode || 'ollama';

    if (mode === 'ollama') {
      try {
        raw = await this._callOllamaClassifier(messages);
        log.debug('Ollama classifier used', { model: this.config?.keys?.ollama_model || 'llama3.2:1b' });
      } catch (err) {
        log.warn('Ollama unavailable, falling back to remote classifier', { error: err.message });
        try {
          const result = await this.callAIWithFallback(messages, { temperature: 0, max_tokens: 120 });
          raw = result?.message?.content || '';
        } catch (err2) {
          log.warn('Remote classifier also failed', { error: err2.message });
          return { isQuestion: false };
        }
      }
    } else {
      try {
        const result = await this.callAIWithFallback(messages, { temperature: 0, max_tokens: 120 });
        raw = result?.message?.content || '';
      } catch (err) {
        log.warn('Remote classifier failed', { error: err.message });
        return { isQuestion: false };
      }
    }

    try {
      const jsonStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
      return JSON.parse(jsonStr.match(/\{[\s\S]*\}/)?.[0] || jsonStr);
    } catch (err) {
      log.warn('Failed to parse classifier response', { error: err.message });
      return { isQuestion: false };
    }
  }

  /**
   * Stream an answer to an interview question using the full transcript as context.
   * Yields { token, provider } objects.
   */
  async *answerInterviewQuestion(questionText, transcriptContext = '') {
    const template = this.readPromptFromFile('interview-answer');
    const systemPrompt = template.replace('{TRANSCRIPT_CONTEXT}', transcriptContext || '(no context yet)');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: questionText },
    ];
    yield* this.callAIWithFallbackStream(messages, {
      temperature: 0.7,
      max_tokens: 2048,
    });
  }
}

export default new AIService();
