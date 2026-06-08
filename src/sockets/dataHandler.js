/**
 * WebSocket handler for /data-updates namespace
 * Handles connection, error, and processing events
 *
 * Two main processing flows:
 * 1. Screenshot Flow:
 *    - Screenshot captured → OCR extraction → AI processing with 'system' prompt
 *    - Generates messageId and stores question/answer
 *
 * 2. Always-On Listen Flow (Cmd+Shift+X toggle):
 *    - toggle_listen_mode → POST /always-on-mode to transcriber
 *    - StreamingSTT in Python emits stt_partial while speaking, stt_final on silence
 *    - handleSttFinal() → answerInterviewQuestion() → streams tokens to HUD
 */
import { EventEmitter } from 'events';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger.js';
import { logEvent } from '../utils/telemetry.js';
import { recordHistogram, addCounter } from '../utils/telemetry.js';
import aiService, { aiCostUSD } from '../services/ai.service.js';
import imageProcessingService from '../services/image-processing.service.js';
import InterviewTranscriptBuffer from './InterviewTranscriptBuffer.js';
import sessionService from '../services/session.service.js';

const log = logger('DataHandler');

// Constants
const VALID_PROMPT_TYPES = ['debug', 'theory', 'coding'];
const DEFAULT_PROMPT_TYPE = 'transcription';
const SCREENSHOT_PROMPT_TYPE = 'system';

// Message data TTL: expire entries older than 30 minutes
const MESSAGE_TTL_MS = 30 * 60 * 1000;
// Cleanup interval: run every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

class DataHandler extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.namespace = null;
    this.selectedPrompts = new Map();
    this.messageData = new Map(); // messageId -> { question, answer, promptType, socketId, timestamp }
    this.pendingPrompts = new Map();
    this.transcriptBuffer = new InterviewTranscriptBuffer();
    this._cleanupTimer = null;
    this.setupNamespace();
    this._startMessageCleanup();
  }

  setupNamespace() {
    this.namespace = this.io.of('/data-updates');
    log.info('Setting up /data-updates namespace');
    this.namespace.on('connection', (socket) => {
      this.handleConnection(socket);
    });
    log.info('Namespace setup complete');
  }

  // ==================== TTL Cleanup ====================

  _startMessageCleanup() {
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      for (const [id, data] of this.messageData) {
        if (now - data.timestamp > MESSAGE_TTL_MS) {
          this.messageData.delete(id);
          removed++;
        }
      }
      if (removed > 0) {
        log.info(`TTL cleanup: removed ${removed} expired message(s), ${this.messageData.size} remaining`);
      }
    }, CLEANUP_INTERVAL_MS);

    // Don't block process exit
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  // ==================== Connection Handling ====================

  handleConnection(socket) {
    log.info('Client connected', { socketId: socket.id });
    this.emitToSocket(socket, 'connected', {
      socketId: socket.id,
      connectedAt: new Date().toISOString(),
      timestamp: Date.now(),
    });

    socket.on('disconnect', (reason) => this.handleDisconnect(socket, reason));
    socket.on('error', (error) => this.handleError(socket, error));
    socket.on('use_prompt', (data) => this.handleUsePrompt(socket, data));
    socket.on('toggle_listen_mode', (data) => this.handleToggleListenMode(socket, data));
    socket.on('listen_state_update', (data) => this.namespace.emit('listen_state_changed', { listening: !!data.listening }));
    socket.on('stt_partial', (data) => this.handleSttPartial(data));
    socket.on('stt_final',   (data) => this.handleSttFinal(socket, data));
    socket.on('enroll_voice',              () => this.handleEnrollVoice());
    socket.on('get_enrollment_status',     () => this.handleGetEnrollmentStatus(socket));
    socket.on('load_speaker_id',           (data) => this.handleLoadSpeakerId(socket, data));
    socket.on('speaker_id_unavailable',    (data) => this.handleSpeakerIdUnavailable(data));
    socket.on('set_stt_model', (data) => this.handleSetSttModel(socket, data));
    socket.on('set_answer_mode', (data) => this.handleSetAnswerMode(socket, data));
    socket.on('get_settings', () => this.handleGetSettings(socket));
    socket.on('set_hud_opacity', (data) => this.handleSetHudOpacity(data));
    socket.on('set_vad_config', (data) => this.handleSetVadConfig(socket, data));
    socket.on('end_session', () => this.handleEndSession(socket));
  }

  handleDisconnect(socket, reason) {
    log.info('Client disconnected', { socketId: socket.id, reason });
    this.cleanupSocketData(socket.id);
    this.emitToSocket(socket, 'connection_status', {
      status: 'disconnected',
      socketId: socket.id,
      reason,
      timestamp: Date.now(),
    });
  }

  cleanupSocketData(socketId) {
    const cleanupActions = [
      { map: this.selectedPrompts, name: 'selected prompt' },
      { map: this.pendingPrompts, name: 'pending prompt' },
    ];
    cleanupActions.forEach(({ map, name }) => {
      if (map.has(socketId)) {
        map.delete(socketId);
        log.info(`Cleaned up ${name} for disconnected socket`, { socketId });
      }
    });
  }

  handleError(socket, error) {
    const errorMessage = error.message || 'Unknown error';
    log.error('Socket error', { socketId: socket.id, error: errorMessage });
    this.emitToSocket(socket, 'error', {
      socketId: socket.id,
      error: errorMessage,
      timestamp: Date.now(),
    });
  }

  // ==================== use_prompt ====================

  async handleUsePrompt(socket, data) {
    const { promptType, screenshotRequired = false, messageId } = data || {};

    const validationError = this.validateUsePromptInput(socket, promptType, messageId);
    if (validationError) return;

    const messageData = this.messageData.get(messageId);
    if (!messageData) {
      log.warn('Message data not found for messageId', { socketId: socket.id, messageId });
      this.emitToSocket(socket, 'use_prompt_error', {
        error: 'Message data not found for the provided messageId',
        messageId,
      });
      return;
    }

    const { question, answer } = messageData;

    if (screenshotRequired) {
      this.handleScreenshotRequired(socket, { promptType, messageId, question, answer });
      return;
    }

    this.emitToSocket(socket, 'use_prompt_set', {
      promptType,
      messageId,
      screenshotRequired: false,
      message: `Processing with ${promptType} prompt`,
      timestamp: Date.now(),
    });

    await this.processPromptWithQuestion(socket, promptType, messageId, question, answer, null);
  }

  validateUsePromptInput(socket, promptType, messageId) {
    if (!promptType || !VALID_PROMPT_TYPES.includes(promptType)) {
      log.warn('Invalid prompt type received', { socketId: socket.id, promptType });
      this.emitToSocket(socket, 'use_prompt_error', {
        error: `Invalid prompt type. Must be one of: ${VALID_PROMPT_TYPES.join(', ')}`,
        received: promptType,
      });
      return true;
    }
    if (!messageId) {
      log.warn('Missing messageId in use_prompt', { socketId: socket.id });
      this.emitToSocket(socket, 'use_prompt_error', { error: 'messageId is required' });
      return true;
    }
    return false;
  }

  handleScreenshotRequired(socket, { promptType, messageId, question, answer }) {
    log.info('Screenshot required, waiting up to 3s for screenshot', {
      socketId: socket.id,
      messageId,
      promptType,
    });

    const timeoutId = setTimeout(async () => {
      const pending = this.pendingPrompts.get(socket.id);
      if (pending && pending.messageId === messageId) {
        log.info('Screenshot timeout elapsed, processing without screenshot', {
          socketId: socket.id,
          messageId,
          promptType,
        });
        this.pendingPrompts.delete(socket.id);
        this.emitToSocket(socket, 'use_prompt_set', {
          promptType,
          messageId,
          screenshotRequired: false,
          message: `Processing with ${promptType} prompt (no screenshot captured)`,
          timestamp: Date.now(),
        });
        await this.processPromptWithQuestion(socket, promptType, messageId, question, answer, null);
      }
    }, 3000);

    this.pendingPrompts.set(socket.id, {
      promptType,
      messageId,
      screenshotRequired: true,
      question,
      answer,
      timeoutId,
    });

    this.emitToSocket(socket, 'use_prompt_set', {
      promptType,
      messageId,
      screenshotRequired: true,
      message: `Waiting for screenshot to process with ${promptType} prompt`,
      timestamp: Date.now(),
    });
  }

  /**
   * Processes a prompt with streaming AI.
   * Emits ai_token to the requesting socket, ai_processing_complete to the namespace.
   */
  async processPromptWithQuestion(
    socket,
    promptType,
    sourceMessageId,
    question,
    answer,
    screenshotText,
  ) {
    try {
      const socketId = socket?.id || 'unknown';
      log.info('Processing prompt with question', {
        socketId,
        promptType,
        sourceMessageId,
        hasScreenshotText: !!screenshotText,
      });

      const promptText = this.buildPromptText(promptType, question, answer, screenshotText);
      const messageId = this.generateMessageId();

      this.emitAIStarted('prompt', question, false);

      const aiStartTime = Date.now();
      let fullResponse = '';
      let provider = 'unknown';

      for await (const chunk of aiService.askGptStream(promptText, promptType)) {
        // Skip the final {usage,...} marker — token-only consumer.
        if (!chunk?.token) continue;
        fullResponse += chunk.token;
        provider = chunk.provider;
        this.emitToSocket(socket, 'ai_token', { token: chunk.token, messageId });
      }

      const aiDuration = Date.now() - aiStartTime;

      this.storeMessageData(messageId, question, fullResponse, promptType, socketId);

      log.info('Prompt processing completed', {
        socketId,
        sourceMessageId,
        newMessageId: messageId,
        promptType,
        provider,
        aiDuration: `${aiDuration}ms`,
        responseLength: fullResponse.length,
      });

      this.emitAIComplete('prompt', fullResponse, provider, aiDuration, false, messageId);
    } catch (err) {
      log.error('Error processing prompt with question', {
        socketId: socket?.id || 'unknown',
        sourceMessageId,
        promptType,
        error: err.message,
        stack: err.stack,
      });
      this.emitProcessingError('prompt', 'prompt', err);
    }
  }

  buildPromptText(promptType, question, answer, screenshotText) {
    switch (promptType) {
      case 'debug': {
        let promptText = `Question: ${question}\n\nAnswer: ${answer}`;
        if (screenshotText) promptText += `\n\nScreenshot text:\n${screenshotText}`;
        return promptText;
      }
      case 'theory':
      case 'coding':
        return question;
      default:
        throw new Error(`Unknown prompt type: ${promptType}`);
    }
  }

  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== Message Data Management ====================

  storeMessageData(messageId, question, answer, promptType, socketId) {
    this.messageData.set(messageId, {
      question,
      answer,
      promptType,
      socketId,
      timestamp: Date.now(),
    });
    log.info('Message data stored', {
      messageId,
      questionLength: question?.length || 0,
      answerLength: answer?.length || 0,
      promptType,
      socketId,
    });
  }

  getMessageData(messageId) {
    return this.messageData.get(messageId) || null;
  }

  getPendingPrompt(socketId) {
    return this.pendingPrompts.get(socketId) || null;
  }

  clearPendingPrompt(socketId) {
    const pending = this.pendingPrompts.get(socketId);
    if (pending?.timeoutId) clearTimeout(pending.timeoutId);
    this.pendingPrompts.delete(socketId);
  }

  getSelectedPromptType() {
    if (this.selectedPrompts.size === 0) return null;
    return this.selectedPrompts.values().next().value;
  }

  // ==================== Emit Helpers ====================

  emitToSocket(socket, event, data) {
    if (socket && socket.emit) socket.emit(event, data);
  }

  emitScreenshotCaptured(filename, filePath) {
    if (!this.namespace) return;
    log.info('Screenshot captured', { filename });
    this.namespace.emit('screenshot_captured', {
      message: `Screenshot captured: ${filename}`,
    });
  }

  emitOCRStarted(filename, filePath) {
    if (!this.namespace) return;
    log.info('OCR started');
    this.namespace.emit('ocr_started', { message: 'OCR started' });
  }

  emitOCRComplete(filename, extractedText, duration) {
    if (!this.namespace) return;
    log.info('OCR completed', { extractedTextLength: extractedText?.length });
    this.namespace.emit('ocr_complete', { message: 'OCR completed' });
  }

  emitAIStarted(filename, extractedText, useContext) {
    if (!this.namespace) return;
    log.info('AI processing started');
    this.namespace.emit('ai_processing_started', { message: 'AI processing started' });
  }

  emitAIComplete(filename, response, provider, duration, useContext, messageId = null) {
    if (!this.namespace) return;
    log.info('AI processing completed', { messageId, responseLength: response?.length });
    const eventData = { response, message: 'AI processing completed' };
    if (messageId) eventData.messageId = messageId;
    this.namespace.emit('ai_processing_complete', eventData);
  }

  emitProcessingError(filename, stage, error) {
    if (!this.namespace) return;
    const errorMessage = error.message || 'Unknown error';
    log.error(`Error during ${stage} processing`, { error: errorMessage });
    this.namespace.emit('aiprocessing_error', {
      error: errorMessage,
      message: `Error during ${stage} processing`,
    });
  }

  // ==================== Streaming STT (always-on mode) ====================

  // Relay stt_partial directly to all HUD clients.
  // The HUD handler at hud.html:809 displays committed (bright) + tentative (dim).
  handleSttPartial(data) {
    const { committed, tentative } = data || {};
    // Allow empty strings through — they signal "clear the live strip" (e.g. candidate voice discarded)
    if (committed === undefined && tentative === undefined) return;
    this.namespace.emit('stt_partial', {
      committed: committed || '',
      tentative: tentative || '',
    });
  }

  // Streams an AI answer for an interview question.
  // Buffers tokens until the AI outputs the "Q: ...\nA:" prefix, then:
  //   - emits question_text_updated with the extracted question
  //   - streams remaining tokens as question_answer_token
  // Returns { answerText, stageLatencies, providerInfo } so callers can write
  // a per-question telemetry record.
  //
  // Fix #8 — instruments ai_ttft_ms + ai_total_ms (transcription flow). When
  // silenceStartedAtSec is provided (always-on flow), composes
  // end_to_end_question_ms from that anchor to first AI token.
  async _streamInterviewAnswer(rawText, questionId, transcriptContext, memoryContext, silenceStartedAtSec = null) {
    let buffer = '';
    let answerText = '';
    let questionExtracted = false;
    let firstTokenAt = null;
    let providerInfo = null;
    let usage        = null;   // { input_tokens, output_tokens } captured on the final chunk
    const startedAt = performance.now();

    for await (const chunk of aiService.answerInterviewQuestion(rawText, transcriptContext, memoryContext)) {
      // ai.service annotates every chunk with provider/model
      if (!providerInfo && chunk && chunk.provider) {
        providerInfo = { provider: chunk.provider, model: chunk.model || '' };
      }
      // Final-chunk usage payload — capture and continue (no token to emit)
      if (chunk.usage) {
        usage = chunk.usage;
        continue;
      }
      const { token } = chunk;
      if (!token) continue;
      if (firstTokenAt === null) {
        firstTokenAt = performance.now();
        recordHistogram('ai_ttft_ms', firstTokenAt - startedAt, {
          provider: providerInfo?.provider || 'unknown',
          model:    providerInfo?.model    || 'unknown',
          flow:     'transcription',
        });
        if (silenceStartedAtSec) {
          // silence_started_at comes from Python as a unix-time seconds float.
          // Compose end-to-end with wall-clock so the units match.
          recordHistogram('end_to_end_question_ms',
            (Date.now() / 1000 - silenceStartedAtSec) * 1000.0);
        }
      }
      if (!questionExtracted) {
        buffer += token;
        // Match the required format: Q: <question>\nA: (with optional extra newlines)
        const match = buffer.match(/^Q:\s*(.+?)\n+A:\s*/s);
        if (match) {
          questionExtracted = true;
          // How long did the user see raw transcript before the AI-cleaned
          // question appeared in the Q&A card? = total time the "Q: …" prefix
          // needed to finish streaming.
          recordHistogram('question_extraction_ms', performance.now() - startedAt, {
            provider: providerInfo?.provider || 'unknown',
          });
          this.namespace.emit('question_text_updated', { questionId, questionText: match[1].trim() });
          const answerStart = buffer.slice(match[0].length);
          if (answerStart) {
            answerText += answerStart;
            this.namespace.emit('question_answer_token', { token: answerStart, questionId });
          }
        }
      } else {
        answerText += token;
        this.namespace.emit('question_answer_token', { token, questionId });
      }
    }

    if (!questionExtracted) {
      answerText = buffer;
      if (buffer) this.namespace.emit('question_answer_token', { token: buffer, questionId });
    }

    const totalMs = performance.now() - startedAt;
    recordHistogram('ai_total_ms', totalMs, {
      provider: providerInfo?.provider || 'unknown',
      model:    providerInfo?.model    || 'unknown',
      flow:     'transcription',
    });

    // ── AI observability — tokens + cost ──
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0, costUsd = 0;
    if (usage && providerInfo) {
      inputTokens         = usage.input_tokens  || 0;
      outputTokens        = usage.output_tokens || 0;
      cacheReadTokens     = usage.cache_read_input_tokens     || 0;
      cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      // For Anthropic, cache_read_input_tokens are billed at ~10% of input cost;
      // cache_creation_input_tokens are billed at ~125% of input cost. Total
      // input billed = input_tokens (already excludes cached) + creation cost
      // adjustment. For simplicity we price input_tokens at the full rate and
      // surface cache visibility as separate metrics; close enough for trending.
      costUsd      = aiCostUSD(providerInfo.model, inputTokens, outputTokens);
      const labels = { provider: providerInfo.provider, model: providerInfo.model || 'unknown', flow: 'transcription' };
      addCounter('ai_input_tokens_total',  inputTokens,  labels);
      addCounter('ai_output_tokens_total', outputTokens, labels);
      addCounter('ai_cost_usd_total',      costUsd,      labels);
      if (cacheReadTokens)     addCounter('ai_cache_read_tokens_total',     cacheReadTokens,     labels);
      if (cacheCreationTokens) addCounter('ai_cache_creation_tokens_total', cacheCreationTokens, labels);
    }

    return {
      answerText,
      cleanedQuestion: match ? match[1].trim() : buffer.trim(),
      stageLatencies: {
        ai_ttft_ms:  firstTokenAt !== null ? firstTokenAt - startedAt : null,
        ai_total_ms: totalMs,
      },
      providerInfo: providerInfo || { provider: 'unknown', model: '' },
      tokens: {
        input: inputTokens, output: outputTokens, cost_usd: costUsd,
        cache_read: cacheReadTokens, cache_creation: cacheCreationTokens,
      },
    };
  }

  // stt_final fires from Python when StreamingSTT detects ≥700ms of VAD silence.
  // Single entry point for turning speech into an AI answer.
  async handleSttFinal(socket, data) {
    const { text, uid, silence_started_at, timestamp } = data || {};
    if (!text || !text.trim()) return;

    // Python→Node socket RTT. `timestamp` is Python's time.time() at emit; Node
    // reads Date.now()/1000 on receive. Non-negative clamp in case the two
    // clocks drift slightly (both services live on the same box so drift is
    // normally < 1 ms, but the clamp is cheap insurance).
    if (typeof timestamp === 'number') {
      const rttMs = Math.max(0, (Date.now() / 1000 - timestamp) * 1000.0);
      recordHistogram('stt_socket_rtt_ms', rttMs);
    }

    const questionId        = `q-${Date.now()}`;
    const transcriptContext = this.transcriptBuffer.getTranscriptContext();
    const memoryContext     = this.transcriptBuffer.getMemoryContext();
    this.transcriptBuffer.addUtterance(text);

    log.info('Processing stt_final as interview question', { questionId, uid, textLength: text.length });

    // ── Session: ensure active + record STT event ──
    let session;
    try {
      session = sessionService.ensureActiveSession();
      sessionService.appendEvent(session.id, 'stt_final_received', { questionId, textLength: text.length });
    } catch (sessionErr) {
      log.warn('Failed to record stt_final_received event', { questionId, error: sessionErr.message });
    }

    this.namespace.emit('interviewer_question', { questionId, questionText: text });
    this.namespace.emit('question_answer_started', { questionId });

    // ── Record AI answer started ──
    if (session) {
      try { sessionService.appendEvent(session.id, 'ai_answer_started', { questionId }); } catch (_) { /* best-effort */ }
    }

    try {
      const result = await this._streamInterviewAnswer(
        text, questionId, transcriptContext, memoryContext,
        typeof silence_started_at === 'number' ? silence_started_at : null,
      );
      const { answerText, cleanedQuestion, stageLatencies, providerInfo, tokens } = result;
      this.namespace.emit('question_answer_complete', { questionId, response: answerText });
      log.info('stt_final question answered', { questionId, responseLength: answerText.length });

      // One log event per answered question. Fields kept intentionally lean so
      // the "Q/A log" dashboard panels stay readable. End-to-end latency is
      // the user-visible one — ai_ttft / token counts are already in metrics.
      const latencyMs = (typeof silence_started_at === 'number')
        ? Math.max(0, Date.now() / 1000 - silence_started_at) * 1000.0
        : stageLatencies.ai_total_ms;
      logEvent('question_answered', 'INFO', {
        flow: 'transcription',
        question: text,
        answer:   answerText,
        provider: providerInfo.provider,
        model:    providerInfo.model,
        latency_ms: Math.round(latencyMs || 0),
        cost_usd:   tokens.cost_usd,
      });

      if (text && answerText) this.transcriptBuffer.addQAPair(text, answerText);

      // ── Record answer completed ──
      if (session) {
        try {
          sessionService.appendEvent(session.id, 'ai_answer_completed', {
            questionId,
            provider: providerInfo.provider,
            model: providerInfo.model,
            latency_ms: Math.round(stageLatencies.ai_total_ms || 0),
            output_tokens: tokens.output,
          });
        } catch (_) { /* best-effort */ }
      }

      // Fire-and-forget: persist conversation turn.
      // Write must not block the socket event — setTimeout(0) defers it past
      // question_answer_complete so the HUD gets its tokens without delay.
      setTimeout(() => {
        try {
          const sid = session ? session.id : sessionService.ensureActiveSession().id;
          sessionService.appendTurn(sid, {
            raw_transcript: text,
            cleaned_question: cleanedQuestion || text,
            answer: answerText,
            provider: providerInfo.provider,
            model: providerInfo.model,
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            cost_usd: tokens.cost_usd,
            latency_ms: Math.round(stageLatencies.ai_total_ms || 0),
          });
          log.info('Conversation turn persisted', { sessionId: sid });
        } catch (sessionErr) {
          log.warn('Failed to persist conversation turn', { questionId, error: sessionErr.message });
        }
      }, 0).unref();
    } catch (err) {
      log.error('Error answering stt_final question', { questionId, error: err.message });
      this.namespace.emit('question_answer_complete', { questionId, response: 'Error generating answer.' });
      logEvent('question_answer_failed', 'ERROR', { flow: 'transcription', error: err.message });

      // ── Record answer failed ──
      if (session) {
        try {
          sessionService.appendEvent(session.id, 'ai_answer_failed', { questionId, error: err.message });
        } catch (_) { /* best-effort */ }
      }
    }
  }

  // ==================== Voice Enrollment ====================

  // Trigger 30-second voice enrollment recording in Python transcriber.
  // Broadcasts enrollment_started to all clients (settings page shows countdown).
  async handleEnrollVoice() {
    log.info('Voice enrollment triggered');
    this.namespace.emit('enrollment_started', { seconds: 30 });
    try {
      const res  = await fetch('http://localhost:8000/enroll-voice', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      const result = { success: res.ok, ...body };
      log.info('Voice enrollment complete', result);
      logEvent('voice_enrolled', 'INFO', { module: 'DataHandler', success: res.ok });
      this.namespace.emit('enrollment_complete', result);
    } catch (err) {
      log.warn('Enrollment request failed', { error: err.message });
      this.namespace.emit('enrollment_complete', { success: false, error: err.message });
    }
  }

  async handleGetEnrollmentStatus(socket) {
    try {
      const res  = await fetch('http://localhost:8000/enrollment-status');
      const body = await res.json().catch(() => ({}));
      this.emitToSocket(socket, 'enrollment_status', body);
    } catch (_) {
      this.emitToSocket(socket, 'enrollment_status', {
        model_loaded: false, enrolled: false,
      });
    }
  }

  // Fix #7: relay speaker_id_unavailable from Python to HUD clients so the
  // banner can render with the right reason ('load_failed' or 'not_enrolled').
  handleSpeakerIdUnavailable(data) {
    log.warn('Speaker ID unavailable', { reason: data?.reason });
    this.namespace.emit('speaker_id_unavailable', data || {});
  }

  // Dynamically load the SpeechBrain ECAPA speaker ID model. No HF token
  // required — body just carries an optional `threshold`. Persists the
  // enabled flag + threshold to config so it survives restarts.
  async handleLoadSpeakerId(socket, data = {}) {
    const threshold = data.threshold ?? 0.70;

    // Persist speaker ID settings to .env
    const envPath = join(process.cwd(), '.env');
    try {
      let content = readFileSync(envPath, 'utf8');
      const setKey = (c, key, val) => {
        const re = new RegExp(`^${key}=.*$`, 'm');
        return re.test(c) ? c.replace(re, `${key}=${val}`) : c + `\n${key}=${val}`;
      };
      content = setKey(content, 'SPEAKER_ID_ENABLED', 'true');
      content = setKey(content, 'SPEAKER_ID_THRESHOLD', String(threshold));
      writeFileSync(envPath, content, 'utf8');
    } catch (e) {
      log.warn('Could not persist speaker_id config', { error: e.message });
    }

    this.emitToSocket(socket, 'speaker_id_loading', {});
    log.info('Loading speaker ID model on-demand via /load-speaker-id');

    try {
      const res  = await fetch('http://localhost:8000/load-speaker-id', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ threshold }),
      });
      const body = await res.json().catch(() => ({}));
      this.emitToSocket(socket, 'speaker_id_loaded', { success: res.ok, ...body });

      if (res.ok) {
        // Broadcast fresh enrollment status to all connected clients
        const statusRes  = await fetch('http://localhost:8000/enrollment-status');
        const statusBody = await statusRes.json().catch(() => ({}));
        this.namespace.emit('enrollment_status', statusBody);
      }
    } catch (err) {
      log.error('handleLoadSpeakerId error', { error: err.message });
      this.emitToSocket(socket, 'speaker_id_loaded', { success: false, error: err.message });
    }
  }

  // ==================== Listen Mode Toggle ====================

  async handleToggleListenMode(socket, data) {
    const { enabled } = data || {};
    try {
      await fetch('http://localhost:8000/always-on-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      });
      log.info('Listen mode toggled', { enabled });
      logEvent(enabled ? 'listen_started' : 'listen_stopped', 'INFO', { module: 'DataHandler' });
      this.namespace.emit('listen_state_changed', { listening: !!enabled });
    } catch (err) {
      log.warn('Could not reach Python transcriber to toggle listen mode', { error: err.message });
      // Revert button state on failure
      this.namespace.emit('listen_state_changed', { listening: !enabled });
    }
  }

  // ==================== Settings ====================

  async handleSetSttModel(socket, data) {
    const { model } = data || {};
    if (!model) return;
    try {
      const res = await fetch('http://localhost:8000/set-stt-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.emitToSocket(socket, 'settings_error', { error: body.detail || 'Failed to set STT model' });
        return;
      }
      log.info('STT model changed', { model });
      logEvent('stt_model_changed', 'INFO', { module: 'DataHandler', model });
      this.emitToSocket(socket, 'stt_model_updated', { model });
    } catch (err) {
      log.warn('Could not reach Python transcriber to set STT model', { error: err.message });
      this.emitToSocket(socket, 'settings_error', { error: 'Python transcriber unreachable' });
    }
  }

  handleSetAnswerMode(socket, data) {
    const { mode } = data || {};
    if (!mode) return;
    aiService.setAnswerMode(mode);
    log.info('Answer mode changed', { mode });
    logEvent('answer_mode_changed', 'INFO', { module: 'DataHandler', mode });
    this.emitToSocket(socket, 'answer_mode_updated', { mode });
  }

  async handleGetSettings(socket) {
    let sttModel = 'small';
    try {
      const res = await fetch('http://localhost:8000/settings');
      if (res.ok) {
        const body = await res.json();
        sttModel = body.stt_model || 'small';
      }
    } catch (_) {
      // transcriber may not be running; return defaults
    }
    const answerMode = aiService._answerMode || aiService.config?.answer_mode || 'auto';
    const enabledProviders = aiService.config?.enabled || aiService.config?.order || [];
    this.emitToSocket(socket, 'settings_state', { sttModel, answerMode, enabledProviders });
  }

  async handleSetVadConfig(socket, data) {
    if (!data || typeof data !== 'object') return;
    try {
      const res = await fetch('http://localhost:8000/set-vad-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.emitToSocket(socket, 'settings_error', { error: body.detail || 'Failed to update VAD config' });
        return;
      }
      log.info('VAD config updated', data);
      logEvent('vad_config_changed', 'INFO', { module: 'DataHandler', config: data });
      this.emitToSocket(socket, 'vad_config_updated', data);
    } catch (err) {
      log.warn('Could not reach Python transcriber to set VAD config', { error: err.message });
      this.emitToSocket(socket, 'settings_error', { error: 'Python transcriber unreachable' });
    }
  }

  handleSetHudOpacity(data) {
    const value = (typeof data === 'object' && data !== null) ? data.value : data;
    if (value === undefined || value === null) return;
    const clamped = Math.max(0, Math.min(100, parseInt(value) || 0));
    log.info('HUD opacity changed', { value: clamped });
    logEvent('hud_opacity_changed', 'INFO', { module: 'DataHandler', value: clamped });
    // Broadcast to all clients (HUD will pick this up)
    if (this.namespace) {
      this.namespace.emit('hud_opacity_updated', { value: clamped });
    }
  }

  async handleEndSession(socket) {
    try {
      if (!sessionService.activeSessionId) {
        this.emitToSocket(socket, 'end_session_error', { error: 'No active session to end' });
        return;
      }

      const session = sessionService.endSession(sessionService.activeSessionId);
      if (!session) {
        this.emitToSocket(socket, 'end_session_error', { error: 'Active session not found' });
        return;
      }

      log.info('Session ended via Socket.IO', { sessionId: session.id, status: session.status });
      this.namespace.emit('session_ended', {
        sessionId: session.id,
        status: session.status,
        ended_at: session.ended_at,
      });
    } catch (err) {
      log.error('Error ending session via Socket.IO', { error: err.message });
      this.emitToSocket(socket, 'end_session_error', { error: err.message });
    }
  }
}

export default DataHandler;
