import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

dotenv.config();

const log = logger('AIService');

const CONFIG_FILE_PATH = path.join(process.cwd(), 'config', 'api-keys.json');

const PROMPT_FILE_MAP = {
  system: 'system-prompt.txt',
  context: 'context-prompt.txt',
  transcription: 'transcription-prompt.txt',
  debug: 'debug-prompt.txt',
  coding: 'coding-prompt.txt',
  theory: 'theory-prompt.txt',
  'interview-classifier': 'interview-classifier-prompt.txt',
  'interview-answer': 'interview-answer-prompt.txt',
  'interview-combined': 'interview-combined-prompt.txt',
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
   * modelOverride — specific model string (e.g. 'llama3.2:3b'); falls back to config.
   * Throws if Ollama is unreachable.
   */
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

  /**
   * Stream tokens from a local Ollama model.
   * Yields raw token strings (no provider wrapping).
   */
  async *_streamOllama(messages, options = {}) {
    const model = options.model || this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' });
    const stream = await openai.chat.completions.create({
      model,
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

  /**
   * Summarize a single Q&A pair into a concise one-line summary via Ollama.
   * Returns the summary string, or throws on failure.
   */
  async summarizeQAPair(question, answer) {
    const model = this.config?.keys?.ollama_model || 'llama3.2:1b';
    const openai = new OpenAI({ apiKey: 'ollama', baseURL: 'http://localhost:11434/v1' });
    const messages = [
      {
        role: 'system',
        content: 'Summarize this interview Q&A into one concise line (max 40 words). Include the topic and key points covered. No bullet points, no preamble — just the summary line.',
      },
      {
        role: 'user',
        content: `Q: ${question}\nA: ${answer}`,
      },
    ];
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0,
      max_tokens: 100,
    });
    return completion.choices[0]?.message?.content || '';
  }

  /**
   * Classifier mode — format: '<type>[:<model>]'
   *   'ollama'              → local Ollama, use configured ollama_model
   *   'ollama:llama3.2:1b'  → local Ollama, use llama3.2:1b specifically
   *   'ollama:llama3.2:3b'  → local Ollama, use llama3.2:3b specifically
   *   'remote'              → first available remote provider (fallback chain)
   *   'remote:grok'         → Grok specifically
   *   'remote:openai'       → OpenAI specifically
   *   'remote:gemini'       → Gemini specifically
   */
  /** @deprecated No longer used — classification is now part of the combined call. */
  setClassifierMode(mode) {
    this._classifierMode = mode;
    log.info(`Classifier mode set to: ${mode}`);
  }

  /**
   * Answer mode — which provider to use when streaming question answers.
   *   'auto'    → fallback chain through enabled providers (default)
   *   'ollama'  → local Ollama
   *   'openai'  → OpenAI only
   *   'grok'    → Grok only
   *   'gemini'  → Gemini only
   */
  setAnswerMode(mode) {
    this._answerMode = mode;
    log.info(`Answer mode set to: ${mode}`);
  }

  /**
   * Classify an interviewer utterance as a question (or follow-up).
   * Routes based on _classifierMode; falls back gracefully.
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
    const colonIdx = mode.indexOf(':');
    const modeType = colonIdx === -1 ? mode : mode.slice(0, colonIdx);
    const modeModel = colonIdx === -1 ? '' : mode.slice(colonIdx + 1); // e.g. 'llama3.2:1b' or 'grok'

    if (modeType === 'ollama') {
      const ollamaModel = modeModel || this.config?.keys?.ollama_model || 'llama3.2:1b';
      try {
        raw = await this._callOllamaClassifier(messages, ollamaModel);
        log.debug('Ollama classifier used', { model: ollamaModel });
      } catch (err) {
        log.warn('Ollama unavailable, falling back to remote classifier', { error: err.message });
        try {
          const result = await this.callAIWithFallback(messages, { temperature: 0, max_tokens: 256 });
          raw = result?.message?.content || '';
        } catch (err2) {
          log.warn('Remote classifier also failed', { error: err2.message });
          return { isQuestion: false };
        }
      }
    } else {
      // remote or remote:<provider>
      const remoteProvider = modeModel; // e.g. 'grok', 'openai', 'gemini', or ''
      try {
        if (remoteProvider && ['openai', 'grok', 'gemini'].includes(remoteProvider)) {
          const opts = { temperature: 0, max_tokens: 256 };
          let response;
          switch (remoteProvider) {
            case 'openai': response = await this.callOpenAI(messages, opts); break;
            case 'grok':   response = await this.callGrok(messages, opts); break;
            case 'gemini': response = await this.callGemini(messages, opts); break;
          }
          raw = response || '';
          log.debug(`Remote classifier used: ${remoteProvider}`);
        } else {
          const result = await this.callAIWithFallback(messages, { temperature: 0, max_tokens: 256 });
          raw = result?.message?.content || '';
        }
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
   * Routes based on _answerMode; falls back to provider chain if needed.
   * Yields { token, provider } objects.
   */
  async *answerInterviewQuestion(questionText, transcriptContext = '') {
    const template = this.readPromptFromFile('interview-answer');
    const systemPrompt = template.replace('{TRANSCRIPT_CONTEXT}', transcriptContext || '(no context yet)');
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: questionText },
    ];

    const answerMode = this._answerMode || this.config?.answer_mode || 'auto';

    if (answerMode === 'ollama') {
      try {
        for await (const token of this._streamOllama(messages, { temperature: 0.7, max_tokens: 2048 })) {
          yield { token, provider: 'ollama' };
        }
        return;
      } catch (err) {
        log.warn('Ollama answer streaming failed, falling back to remote', { error: err.message });
      }
    } else if (['openai', 'grok', 'gemini'].includes(answerMode)) {
      try {
        const opts = { temperature: 0.7, max_tokens: 2048 };
        let gen;
        switch (answerMode) {
          case 'openai': gen = this.streamOpenAI(messages, opts); break;
          case 'grok':   gen = this.streamGrok(messages, opts); break;
          case 'gemini': gen = this.streamGemini(messages, opts); break;
        }
        for await (const token of gen) {
          if (token) yield { token, provider: answerMode };
        }
        return;
      } catch (err) {
        log.warn(`${answerMode} answer streaming failed, falling back`, { error: err.message });
      }
    }

    // 'auto' or fallback
    yield* this.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 });
  }

  /**
   * Single-call classify + answer for interview utterances.
   * Streams a structured response: header metadata first, then answer tokens.
   *
   * Yields objects of two types:
   *   { type: 'header', isQuestion: bool, questionText: string, mergeWithPrevious: bool }
   *   { type: 'token', token: string, provider: string }
   *
   * For non-questions, yields a single header with isQuestion=false and returns.
   */
  async *classifyAndAnswerInterviewQuestion(text, previousQuestionText = '', transcriptContext = '', memoryContext = '') {
    const template = this.readPromptFromFile('interview-combined');
    const systemPrompt = template
      .replace('{PREVIOUS_QUESTION}', previousQuestionText || '(none)')
      .replace('{TRANSCRIPT_CONTEXT}', transcriptContext || '(no context yet)')
      .replace('{MEMORY_CONTEXT}', memoryContext || '(no conversation history yet)')
      .replace('{UTTERANCE}', text);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ];

    const answerMode = this._answerMode || this.config?.answer_mode || 'auto';

    // Pick the right streaming source based on answer mode
    let tokenSource;
    let providerName = answerMode;

    if (answerMode === 'ollama') {
      try {
        tokenSource = this._streamOllama(messages, { temperature: 0.7, max_tokens: 2048 });
      } catch (err) {
        log.warn('Ollama unavailable for combined call, falling back', { error: err.message });
        tokenSource = null;
      }
    } else if (['openai', 'grok', 'gemini'].includes(answerMode)) {
      try {
        const opts = { temperature: 0.7, max_tokens: 2048 };
        switch (answerMode) {
          case 'openai': tokenSource = this.streamOpenAI(messages, opts); break;
          case 'grok':   tokenSource = this.streamGrok(messages, opts); break;
          case 'gemini': tokenSource = this.streamGemini(messages, opts); break;
        }
      } catch (err) {
        log.warn(`${answerMode} unavailable for combined call, falling back`, { error: err.message });
        tokenSource = null;
      }
    }

    // Fallback: use the provider chain
    if (!tokenSource) {
      providerName = 'auto';
      tokenSource = (async function* (self) {
        for await (const { token, provider } of self.callAIWithFallbackStream(messages, { temperature: 0.7, max_tokens: 2048 })) {
          providerName = provider;
          yield token;
        }
      })(this);
    }

    // ── Stream header parser (state machine) ──
    const STATE_DETECTING = 0;
    const STATE_QUESTION_TEXT = 1;
    const STATE_MERGE_LINE = 2;
    const STATE_AWAIT_DELIMITER = 3;
    const STATE_STREAMING = 4;

    let state = STATE_DETECTING;
    let buffer = '';
    let questionText = '';
    let mergeWithPrevious = false;
    let tokenCount = 0;
    let headerEmitted = false;

    for await (const token of tokenSource) {
      tokenCount++;

      // Safety: if we haven't found a valid header in 50 tokens, treat as non-question
      if (!headerEmitted && tokenCount > 50) {
        log.warn('Combined call: no valid header after 50 tokens, treating as non-question');
        yield { type: 'header', isQuestion: false, questionText: '', mergeWithPrevious: false };
        return;
      }

      if (state === STATE_STREAMING) {
        yield { type: 'token', token, provider: providerName };
        continue;
      }

      // Accumulate into buffer for header parsing
      buffer += token;

      if (state === STATE_DETECTING) {
        if (buffer.includes('[NOT_A_QUESTION]')) {
          yield { type: 'header', isQuestion: false, questionText: '', mergeWithPrevious: false };
          return;
        }
        if (buffer.includes('[QUESTION]')) {
          // Remove everything up to and including [QUESTION] + optional newline
          buffer = buffer.split('[QUESTION]').slice(1).join('[QUESTION]').replace(/^\n/, '');
          state = STATE_QUESTION_TEXT;
        }
      }

      if (state === STATE_QUESTION_TEXT) {
        const nlIdx = buffer.indexOf('\n');
        if (nlIdx !== -1) {
          questionText = buffer.substring(0, nlIdx).trim();
          buffer = buffer.substring(nlIdx + 1);
          state = STATE_MERGE_LINE;
        }
      }

      if (state === STATE_MERGE_LINE) {
        if (buffer.includes('[MERGE:true]')) {
          mergeWithPrevious = true;
          buffer = buffer.split('[MERGE:true]').slice(1).join('').replace(/^\n/, '');
          state = STATE_AWAIT_DELIMITER;
        } else if (buffer.includes('[MERGE:false]')) {
          mergeWithPrevious = false;
          buffer = buffer.split('[MERGE:false]').slice(1).join('').replace(/^\n/, '');
          state = STATE_AWAIT_DELIMITER;
        }
      }

      if (state === STATE_AWAIT_DELIMITER) {
        if (buffer.includes('---')) {
          headerEmitted = true;
          yield { type: 'header', isQuestion: true, questionText, mergeWithPrevious };

          // Emit any leftover text after the delimiter as the first answer token
          const afterDelimiter = buffer.split('---').slice(1).join('---').replace(/^\n/, '');
          if (afterDelimiter) {
            yield { type: 'token', token: afterDelimiter, provider: providerName };
          }
          state = STATE_STREAMING;
        }
      }
    }

    // Stream ended without emitting a header — treat as non-question
    if (!headerEmitted) {
      log.warn('Combined call: stream ended without complete header');
      yield { type: 'header', isQuestion: false, questionText: '', mergeWithPrevious: false };
    }
  }
}

export default new AIService();
