/**
 * WebSocket handler for /data-updates namespace
 * Handles connection, error, and processing events
 *
 * Two main processing flows:
 * 1. Screenshot Flow:
 *    - Screenshot captured → OCR extraction → AI processing with 'system' prompt
 *    - Generates messageId and stores question/answer
 *
 * 2. Transcription Flow:
 *    - Receives text_chunk events → Accumulates chunks → process_transcription event
 *    - AI processing with 'transcription' prompt (streamed token-by-token)
 *    - Generates messageId and stores question/answer
 */
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import aiService from '../services/ai.service.js';
import imageProcessingService from '../services/image-processing.service.js';
import InterviewTranscriptBuffer from './InterviewTranscriptBuffer.js';

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
    this.transcriptionChunks = new Map();
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
    socket.on('transcription', (data) => this.handleTranscription(socket, data));
    socket.on('process_transcription', () => this.handleProcessTranscription(socket));
    socket.on('interviewer_speech', (data) => this.handleInterviewerSpeech(socket, data));
    socket.on('answer_question', (data) => this.handleAnswerQuestion(socket, data));
    socket.on('toggle_always_on_mode', (data) => this.handleToggleAlwaysOn(socket, data));
    socket.on('set_stt_model', (data) => this.handleSetSttModel(socket, data));
    socket.on('set_classifier', (data) => this.handleSetClassifier(socket, data));
    socket.on('set_answer_mode', (data) => this.handleSetAnswerMode(socket, data));
    socket.on('get_settings', () => this.handleGetSettings(socket));
    socket.on('set_hud_opacity', (data) => this.handleSetHudOpacity(data));
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
      { map: this.transcriptionChunks, name: 'transcription chunks' },
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

  // ==================== Transcription ====================

  handleTranscription(socket, data) {
    const { textChunk } = data || {};
    if (!textChunk || typeof textChunk !== 'string') {
      log.warn('Invalid transcription chunk received', { socketId: socket.id, data });
      return;
    }
    if (!this.transcriptionChunks.has(socket.id)) {
      this.transcriptionChunks.set(socket.id, []);
    }
    const chunks = this.transcriptionChunks.get(socket.id);
    chunks.push(textChunk);
    log.debug('Transcription chunk received', {
      socketId: socket.id,
      chunkLength: textChunk.length,
      totalChunks: chunks.length,
    });
  }

  /**
   * Processes accumulated transcription chunks using streaming AI.
   * Emits ai_token events to the requesting socket during generation,
   * then emits ai_processing_complete to the full namespace when done.
   */
  async handleProcessTranscription(socket) {
    const chunks = this.transcriptionChunks.get(socket.id);

    if (!chunks || chunks.length === 0) {
      log.warn('No transcription chunks found for processing', { socketId: socket.id });
      this.emitToSocket(socket, 'aiprocessing_error', {
        error: 'No transcription data available',
        message: 'Error during transcription processing',
      });
      return;
    }

    try {
      const fullTranscription = chunks.join(' ');
      const promptType = this.selectedPrompts.get(socket.id) || DEFAULT_PROMPT_TYPE;
      const messageId = this.generateMessageId();

      log.info('Processing transcription', {
        socketId: socket.id,
        chunkCount: chunks.length,
        transcriptionLength: fullTranscription.length,
        messageId,
      });

      this.emitAIStarted('transcription', fullTranscription, false);

      const aiStartTime = Date.now();
      let fullResponse = '';
      let provider = 'unknown';

      // Stream tokens to the requesting socket
      for await (const { token, provider: p } of aiService.askGptTranscriptionStream(
        fullTranscription,
        promptType,
      )) {
        fullResponse += token;
        provider = p;
        this.emitToSocket(socket, 'ai_token', { token, messageId });
      }

      const aiDuration = Date.now() - aiStartTime;

      this.storeMessageData(messageId, fullTranscription, fullResponse, promptType, socket.id);

      const processedItem = {
        filename: 'transcription',
        timestamp: new Date().toLocaleString(),
        extractedText:
          fullTranscription.substring(0, 500) +
          (fullTranscription.length > 500 ? '...' : ''),
        gptResponse:
          fullResponse.substring(0, 1000) +
          (fullResponse.length > 1000 ? '...' : ''),
        usedContext: false,
        type: 'transcription',
      };
      imageProcessingService.addProcessedData(processedItem);
      imageProcessingService.setLastResponse(fullResponse);

      this.transcriptionChunks.delete(socket.id);

      log.info('Transcription processing completed', {
        socketId: socket.id,
        messageId,
        provider,
        aiDuration: `${aiDuration}ms`,
        responseLength: fullResponse.length,
      });

      this.emitAIComplete('transcription', fullResponse, provider, aiDuration, false, messageId);
    } catch (err) {
      log.error('Error processing transcription', {
        socketId: socket.id,
        error: err.message,
        stack: err.stack,
      });
      this.transcriptionChunks.delete(socket.id);
      this.emitProcessingError('transcription', 'transcription', err);
    }
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

      for await (const { token, provider: p } of aiService.askGptStream(promptText, promptType)) {
        fullResponse += token;
        provider = p;
        this.emitToSocket(socket, 'ai_token', { token, messageId });
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

  // ==================== Always-On Interview Listener ====================

  async handleInterviewerSpeech(socket, data) {
    const { text } = data || {};
    if (!text || typeof text !== 'string' || !text.trim()) return;

    this.transcriptBuffer.addUtterance(text.trim());
    const lastQ = this.transcriptBuffer.getLastQuestion();

    let result;
    try {
      result = await aiService.classifyInterviewerUtterance(text.trim(), lastQ?.questionText ?? '');
    } catch (err) {
      log.warn('Question classification failed', { error: err.message });
      return;
    }

    if (!result.isQuestion || result.confidence < 0.75) return;

    let questionId;

    if (result.mergeWithPrevious && lastQ) {
      this.transcriptBuffer.mergeQuestion(lastQ.questionId, result.questionText);
      this.namespace.emit('merge_question', {
        questionId: lastQ.questionId,
        questionText: result.questionText,
      });
      log.info('Question merged', { questionId: lastQ.questionId });
      // Re-answer the merged question with updated text
      questionId = lastQ.questionId;
      // Update the stored question text before auto-answering
      const entry = this.transcriptBuffer.getQuestions().find(q => q.questionId === questionId);
      if (entry) entry.questionText = result.questionText;
    } else {
      questionId = `q-${Date.now()}`;
      this.transcriptBuffer.addQuestion(questionId, result.questionText);
      this.namespace.emit('interviewer_question', {
        questionId,
        questionText: result.questionText,
      });
      log.info('New question detected', { questionId, questionText: result.questionText });
    }

    // Auto-answer immediately without waiting for user button press
    this._autoAnswerQuestion(questionId);
  }

  async _autoAnswerQuestion(questionId) {
    const questions = this.transcriptBuffer.getQuestions();
    const entry = questions.find((q) => q.questionId === questionId);
    if (!entry) return;

    const transcriptContext = this.transcriptBuffer.getTranscriptContext();
    this.namespace.emit('question_answer_started', { questionId });

    try {
      let fullResponse = '';
      for await (const { token } of aiService.answerInterviewQuestion(entry.questionText, transcriptContext)) {
        fullResponse += token;
        this.namespace.emit('question_answer_token', { token, questionId });
      }
      this.namespace.emit('question_answer_complete', { questionId, response: fullResponse });
      log.info('Question auto-answered', { questionId, responseLength: fullResponse.length });
    } catch (err) {
      log.error('Error auto-answering question', { questionId, error: err.message });
      this.namespace.emit('question_answer_complete', { questionId, response: 'Error generating answer.' });
    }
  }

  async handleAnswerQuestion(socket, data) {
    const { questionId } = data || {};
    if (!questionId) return;

    const questions = this.transcriptBuffer.getQuestions();
    const entry = questions.find((q) => q.questionId === questionId);
    if (!entry) {
      log.warn('Question not found in buffer', { questionId });
      return;
    }

    const transcriptContext = this.transcriptBuffer.getTranscriptContext();
    this.namespace.emit('question_answer_started', { questionId });

    try {
      let fullResponse = '';
      for await (const { token } of aiService.answerInterviewQuestion(entry.questionText, transcriptContext)) {
        fullResponse += token;
        this.namespace.emit('question_answer_token', { token, questionId });
      }
      this.namespace.emit('question_answer_complete', { questionId, response: fullResponse });
      log.info('Question answered', { questionId, responseLength: fullResponse.length });
    } catch (err) {
      log.error('Error answering question', { questionId, error: err.message });
      this.namespace.emit('question_answer_complete', { questionId, response: 'Error generating answer.' });
    }
  }

  async handleToggleAlwaysOn(socket, data) {
    const { enabled } = data || {};
    try {
      await fetch('http://localhost:8000/always-on-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      });
      log.info('Always-on mode toggled', { enabled });
    } catch (err) {
      log.warn('Could not reach Python transcriber to toggle always-on mode', { error: err.message });
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
      this.emitToSocket(socket, 'stt_model_updated', { model });
    } catch (err) {
      log.warn('Could not reach Python transcriber to set STT model', { error: err.message });
      this.emitToSocket(socket, 'settings_error', { error: 'Python transcriber unreachable' });
    }
  }

  handleSetClassifier(socket, data) {
    const { mode } = data || {};
    if (!mode) return;
    aiService.setClassifierMode(mode);
    log.info('Classifier mode changed', { mode });
    this.emitToSocket(socket, 'classifier_updated', { mode });
  }

  handleSetAnswerMode(socket, data) {
    const { mode } = data || {};
    if (!mode) return;
    aiService.setAnswerMode(mode);
    log.info('Answer mode changed', { mode });
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
    const classifierMode = aiService._classifierMode || aiService.config?.classifier_mode || 'ollama:llama3.2:1b';
    const answerMode = aiService._answerMode || aiService.config?.answer_mode || 'auto';
    const enabledProviders = aiService.config?.enabled || aiService.config?.order || [];
    const ollamaModels = ['llama3.2:1b', 'llama3.2:3b'];
    this.emitToSocket(socket, 'settings_state', { sttModel, classifierMode, answerMode, enabledProviders, ollamaModels });
  }

  handleSetHudOpacity(data) {
    const { value } = data || {};
    if (value === undefined || value === null) return;
    const clamped = Math.max(0, Math.min(100, parseInt(value) || 0));
    log.info('HUD opacity changed', { value: clamped });
    // Broadcast to all clients (HUD will pick this up)
    if (this.namespace) {
      this.namespace.emit('hud_opacity_updated', { value: clamped });
    }
  }
}

export default DataHandler;
