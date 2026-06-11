import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendSuccess, sendError } from '../lib/response.js';
import { badRequest, notFound, internal } from '../lib/errors.js';
import logger from '../utils/logger.js';
import {
  initTelemetry,
  shutdownTelemetry,
  startSystemMetricsSampler,
  validateOtlpEndpoint,
  isEnabled as isTelemetryEnabled,
} from '../utils/telemetry.js';

const log = logger('ConfigController');

const ENV_FILE_PATH = path.join(process.cwd(), '.env');

const KNOWN_PROVIDER_LABELS = {
  openai: 'OpenAI',
  grok: 'Grok (Groq)',
  gemini: 'Gemini',
  claude: 'Claude (Anthropic)',
};

const FALLBACK_MODELS = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  ],
  grok: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  ],
  claude: [
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  ],
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  grok: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-5',
};

class ConfigController {
  // ── .env helpers ─────────────────────────────────────────────────────

  _reloadEnv() {
    dotenv.config({ path: ENV_FILE_PATH, override: true });
  }

  _writeDotEnvKeys(updates) {
    let content = '';
    if (fs.existsSync(ENV_FILE_PATH)) {
      content = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    }
    for (const [key, rawValue] of Object.entries(updates)) {
      const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
      const re = new RegExp(`^${key}=.*$`, 'm');
      if (re.test(content)) {
        content = content.replace(re, `${key}=${value}`);
      } else {
        content += (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
      }
    }
    fs.writeFileSync(ENV_FILE_PATH, content, 'utf8');
    dotenv.config({ path: ENV_FILE_PATH, override: true });
  }

  _readConfig() {
    this._reloadEnv();
    return {
      keys: {
        openai: process.env.OPENAI_API_KEY    || '',
        grok:   process.env.GROQ_API_KEY      || '',
        gemini: process.env.GEMINI_API_KEY    || '',
        claude: process.env.ANTHROPIC_API_KEY || '',
      },
      order:   (process.env.PROVIDER_ORDER   || 'openai,grok,gemini,claude').split(',').map(s => s.trim()),
      enabled: (process.env.PROVIDER_ENABLED || '').split(',').map(s => s.trim()).filter(Boolean),
      models: {
        openai: process.env.MODEL_OPENAI || 'gpt-4o-mini',
        grok:   process.env.MODEL_GROK   || 'llama-3.3-70b-versatile',
        gemini: process.env.MODEL_GEMINI || 'gemini-2.5-flash',
        claude: process.env.MODEL_CLAUDE || 'claude-sonnet-4-5',
      },
      answer_mode:          process.env.ANSWER_MODE                            || 'auto',
      interview_role:       process.env.INTERVIEW_ROLE                         || '',
      stt_model:            process.env.STT_MODEL                              || 'small',
      audio_input_source:   process.env.AUDIO_INPUT_SOURCE                     || '',
      audio_source_mode:    process.env.AUDIO_SOURCE_MODE                      || 'mic',
      hud_opacity:          parseInt(process.env.HUD_OPACITY, 10)              || 27,
      screenshots_path:     process.env.SCREENSHOTS_PATH                       || '',
      speaker_id_threshold: parseFloat(process.env.SPEAKER_ID_THRESHOLD)       || 0.6,
      speaker_id_enabled:   process.env.SPEAKER_ID_ENABLED                     === 'true',
      deepgram_enabled:     process.env.DEEPGRAM_ENABLED                       === 'true',
      deepgram_api_key:     process.env.DEEPGRAM_API_KEY                       || '',
      deepgram_model:       process.env.DEEPGRAM_MODEL                         || 'nova-2',
      deepgram_language:    process.env.DEEPGRAM_LANGUAGE                      || 'en',
      deepgram_endpointing_ms:   parseInt(process.env.DEEPGRAM_ENDPOINTING_MS, 10)   || 300,
      deepgram_utterance_end_ms: parseInt(process.env.DEEPGRAM_UTTERANCE_END_MS, 10) || 1000,
      deepgram_min_word_count:   parseInt(process.env.DEEPGRAM_MIN_WORD_COUNT, 10)   || 2,
      deepgram_enroll_seconds:   parseInt(process.env.DEEPGRAM_ENROLL_SECONDS, 10)   || 5,
      deepgram_diarize:          process.env.DEEPGRAM_DIARIZE                        !== 'false',
      deepgram_smart_format:     process.env.DEEPGRAM_SMART_FORMAT                   !== 'false',
      telemetry: {
        enabled:        process.env.TELEMETRY_ENABLED === 'true',
        otlp_endpoint:  process.env.OTLP_ENDPOINT             || '',
        instance_id:    process.env.GRAFANA_INSTANCE_ID        || '',
        access_token:   process.env.GRAFANA_ACCESS_TOKEN       || '',
        service_prefix: process.env.TELEMETRY_SERVICE_PREFIX   || 'solvewatch',
        grafana_url:    process.env.GRAFANA_URL                || '',
        grafana_sa_token: process.env.GRAFANA_SA_TOKEN         || '',
      },
      host_owner: process.env.HOST_OWNER || '',
    };
  }

  // ── Legacy endpoints ───────────────────────────────────

  getApiKeys(req, res, next) {
    try {
      const config = this._readConfig();
      if (!config) return sendSuccess(res, { config: null });

      const maskedKeys = {};
      if (config.keys) {
        Object.keys(config.keys).forEach((id) => {
          maskedKeys[id] = config.keys[id] ? '***' : '';
        });
      }

      return sendSuccess(res, {
        config: {
          keys: maskedKeys,
          order: config.order || [],
          enabled: config.enabled || config.order || [],
        },
      });
    } catch (err) {
      log.error('Error reading API keys config', err);
      return sendError(res, internal('Failed to read configuration'));
    }
  }

  saveApiKeys(req, res, next) {
    try {
      const { keys, order, enabled } = req.body;
      if (!order || !Array.isArray(order)) {
        throw badRequest('Invalid configuration format');
      }

      const updates = {};
      if (keys) {
        if (keys.openai && keys.openai !== '***') updates.OPENAI_API_KEY = keys.openai.trim();
        if (keys.grok   && keys.grok   !== '***') updates.GROQ_API_KEY   = keys.grok.trim();
        if (keys.gemini && keys.gemini !== '***') updates.GEMINI_API_KEY  = keys.gemini.trim();
        if (keys.claude && keys.claude !== '***') updates.ANTHROPIC_API_KEY = keys.claude.trim();
      }
      updates.PROVIDER_ORDER   = order.join(',');
      updates.PROVIDER_ENABLED = (enabled && Array.isArray(enabled) ? enabled : order).join(',');
      this._writeDotEnvKeys(updates);

      return sendSuccess(res, {
        message: 'Configuration saved',
        config: { keys: { openai: '***', grok: '***', gemini: '***', claude: '***' }, order, enabled: (enabled || order) },
      });
    } catch (err) {
      log.error('Error saving API keys config', err);
      return sendError(res, internal('Failed to save configuration'));
    }
  }

  // ── Full settings read ─────────────────────────────────

  getFullConfig(req, res, next) {
    try {
      const config = this._readConfig();

      const orderedIds = [...new Set([
        ...(config.order || []),
        'openai', 'grok', 'gemini', 'claude',
      ])];

      const enabledSet = new Set(config.enabled || []);

      const providers = orderedIds.map(id => ({
        id,
        label:   KNOWN_PROVIDER_LABELS[id] || id,
        hasKey:  !!(config.keys?.[id]),
        enabled: enabledSet.has(id),
        model:   (config.models?.[id] || DEFAULT_MODELS[id] || ''),
      }));

      return sendSuccess(res, {
        providers,
        stt_model:            config.stt_model             || 'small',
        audio_input_source:   config.audio_input_source    || '',
        audio_source_mode:    config.audio_source_mode     || 'mic',
        answer_mode:          config.answer_mode            || 'auto',
        hud_opacity:          config.hud_opacity            ?? 27,
        screenshots_path:     config.screenshots_path       || '',
        interview_role:       config.interview_role         || '',
        speaker_id_threshold: config.speaker_id_threshold   ?? 0.6,
        speaker_id_enabled:   config.speaker_id_enabled     ?? false,
        deepgram_enabled:     config.deepgram_enabled       ?? false,
        deepgram_model:       config.deepgram_model         || 'nova-2',
        deepgram_language:    config.deepgram_language      || 'en',
        deepgram_endpointing_ms:   config.deepgram_endpointing_ms   ?? 300,
        deepgram_utterance_end_ms: config.deepgram_utterance_end_ms ?? 1000,
        deepgram_min_word_count:   config.deepgram_min_word_count   ?? 2,
        deepgram_enroll_seconds:   config.deepgram_enroll_seconds   ?? 5,
        deepgram_diarize:          config.deepgram_diarize          ?? true,
        deepgram_smart_format:     config.deepgram_smart_format     ?? true,
        deepgram_api_key_set:      !!(config.deepgram_api_key),
      });
    } catch (err) {
      log.error('Error reading full config', err);
      return sendError(res, internal('Failed to read configuration'));
    }
  }

  // ── Full settings save ─────────────────────────────────

  saveFullConfig(req, res, next) {
    try {
      const {
        providers, stt_model, audio_input_source, audio_source_mode, answer_mode, hud_opacity, screenshots_path,
        interview_role, speaker_id_threshold, speaker_id_enabled,
        deepgram_enabled, deepgram_api_key, deepgram_model, deepgram_language,
        deepgram_endpointing_ms, deepgram_utterance_end_ms, deepgram_min_word_count,
        deepgram_enroll_seconds, deepgram_diarize, deepgram_smart_format,
      } = req.body;

      const updates = {};
      const order = [];
      const enabledProviders = [];

      if (Array.isArray(providers)) {
        for (const p of providers) {
          if (!p.id) continue;
          order.push(p.id);
          if (p.enabled) enabledProviders.push(p.id);
          if (p.key && p.key.trim() && p.key !== '***') {
            const envKey = { openai: 'OPENAI_API_KEY', grok: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' }[p.id];
            if (envKey) updates[envKey] = p.key.trim();
          }
          if (p.model && p.model.trim()) {
            const modelKey = { openai: 'MODEL_OPENAI', grok: 'MODEL_GROK', gemini: 'MODEL_GEMINI', claude: 'MODEL_CLAUDE' }[p.id];
            if (modelKey) updates[modelKey] = p.model.trim();
          }
        }
        if (order.length)           updates.PROVIDER_ORDER   = order.join(',');
        if (enabledProviders.length) updates.PROVIDER_ENABLED = enabledProviders.join(',');
      }

      if (stt_model            !== undefined) updates.STT_MODEL             = stt_model;
      if (audio_input_source   !== undefined) updates.AUDIO_INPUT_SOURCE    = audio_input_source;
      if (audio_source_mode    !== undefined) updates.AUDIO_SOURCE_MODE     = audio_source_mode;
      if (answer_mode          !== undefined) updates.ANSWER_MODE           = answer_mode;
      if (hud_opacity          !== undefined) updates.HUD_OPACITY           = String(hud_opacity);
      if (screenshots_path     !== undefined) updates.SCREENSHOTS_PATH      = screenshots_path;
      if (interview_role       !== undefined) updates.INTERVIEW_ROLE        = interview_role;
      if (speaker_id_threshold !== undefined) updates.SPEAKER_ID_THRESHOLD  = String(speaker_id_threshold);
      if (speaker_id_enabled   !== undefined) updates.SPEAKER_ID_ENABLED    = speaker_id_enabled ? 'true' : 'false';
      if (deepgram_enabled      !== undefined) updates.DEEPGRAM_ENABLED      = deepgram_enabled ? 'true' : 'false';
      if (deepgram_api_key && deepgram_api_key !== '***') updates.DEEPGRAM_API_KEY = deepgram_api_key.trim();
      if (deepgram_model        !== undefined) updates.DEEPGRAM_MODEL        = deepgram_model;
      if (deepgram_language     !== undefined) updates.DEEPGRAM_LANGUAGE     = deepgram_language;
      if (deepgram_endpointing_ms   !== undefined) updates.DEEPGRAM_ENDPOINTING_MS   = String(deepgram_endpointing_ms);
      if (deepgram_utterance_end_ms !== undefined) updates.DEEPGRAM_UTTERANCE_END_MS = String(deepgram_utterance_end_ms);
      if (deepgram_min_word_count   !== undefined) updates.DEEPGRAM_MIN_WORD_COUNT   = String(deepgram_min_word_count);
      if (deepgram_enroll_seconds   !== undefined) updates.DEEPGRAM_ENROLL_SECONDS   = String(deepgram_enroll_seconds);
      if (deepgram_diarize          !== undefined) updates.DEEPGRAM_DIARIZE          = deepgram_diarize ? 'true' : 'false';
      if (deepgram_smart_format     !== undefined) updates.DEEPGRAM_SMART_FORMAT     = deepgram_smart_format ? 'true' : 'false';

      this._writeDotEnvKeys(updates);
      log.info('Full config saved', { providers: order, stt_model, answer_mode, deepgram_enabled });

      return sendSuccess(res, { message: 'Settings saved successfully' });
    } catch (err) {
      log.error('Error saving full config', err);
      return sendError(res, internal('Failed to save configuration'));
    }
  }

  // ── Model list for a provider ─────────────────────────

  async getProviderModels(req, res, next) {
    const { providerId } = req.params;
    const config = this._readConfig() || {};
    const apiKey = config.keys?.[providerId];

    const fallback = FALLBACK_MODELS[providerId] || [];

    if (!apiKey) {
      return sendSuccess(res, { models: fallback, source: 'fallback' });
    }

    try {
      let models = [];

      if (providerId === 'openai') {
        const openai = new OpenAI({ apiKey });
        const list = await openai.models.list();
        models = list.data
          .filter(m => m.id.startsWith('gpt-'))
          .sort((a, b) => b.created - a.created)
          .slice(0, 20)
          .map(m => ({ id: m.id, name: m.id }));
      } else if (providerId === 'grok') {
        const groq = new Groq({ apiKey });
        const list = await groq.models.list();
        models = list.data
          .map(m => ({ id: m.id, name: m.id }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } else if (providerId === 'gemini') {
        models = fallback;
      } else if (providerId === 'claude') {
        models = fallback;
      } else {
        models = fallback;
      }

      if (models.length === 0) models = fallback;
      return sendSuccess(res, { models, source: 'live' });
    } catch (err) {
      log.warn(`Could not fetch models for ${providerId}`, { error: err.message });
      return sendSuccess(res, { models: fallback, source: 'fallback' });
    }
  }

  // ── Test Deepgram connection ─────────────────────────

  async testDeepgramKey(req, res, next) {
    let { api_key: apiKey } = req.body || {};
    if (!apiKey || apiKey === '***') {
      this._reloadEnv();
      apiKey = process.env.DEEPGRAM_API_KEY || '';
    }
    if (!apiKey) {
      return sendError(res, badRequest('No Deepgram API key provided'));
    }
    try {
      const r = await fetch('https://api.deepgram.com/v1/models', {
        headers: { Authorization: `Token ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 401) {
        return sendError(res, badRequest('Invalid Deepgram API key (HTTP 401 — check key at console.deepgram.com)'));
      }
      if (!r.ok) {
        return sendError(res, badRequest(`Deepgram returned HTTP ${r.status}`));
      }
      return sendSuccess(res, { message: 'Deepgram API key is valid' });
    } catch (err) {
      return sendError(res, badRequest(`Could not reach Deepgram: ${err.message}`));
    }
  }

  // ── Prompt preview ────────────────────────────────────

  getPromptPreview(req, res, next) {
    try {
      const { type = 'interview-answer' } = req.query;
      const config = this._readConfig() || {};
      const role = config.interview_role?.trim() || '';

      const PROMPT_FILES = {
        'interview-answer': 'interview-answer-prompt.txt',
        'transcription': 'transcription-prompt.txt',
        'system': 'system-prompt.txt',
      };

      const filename = PROMPT_FILES[type];
      if (!filename) {
        return sendError(res, badRequest(`Unknown prompt type: ${type}`));
      }

      const promptPath = path.join(process.cwd(), 'prompts', filename);
      let promptText = '';
      try {
        promptText = fs.readFileSync(promptPath, 'utf8').trim();
      } catch {
        return sendError(res, notFound('Prompt file not found'));
      }

      const rolePrefix = role
        ? `## Interview Context\nRole: ${role}\nTailor your answer specifically for a ${role} interview — use relevant tools, frameworks, and terminology for this domain.\n\n`
        : '';

      return sendSuccess(res, {
        type,
        role: role || null,
        prompt: rolePrefix + promptText,
      });
    } catch (err) {
      log.error('Error reading prompt preview', err);
      return sendError(res, internal('Failed to read prompt'));
    }
  }

  // ── Test provider connection ─────────────────────────

  async testProvider(req, res, next) {
    const { providerId, key: rawKey } = req.body;
    if (!providerId) {
      return sendError(res, badRequest('providerId is required'));
    }

    let key = rawKey;
    if (!key || key === '***' || key === '***STORED***') {
      const config = this._readConfig() || {};
      key = config.keys?.[providerId] || '';
    }

    if (!key) {
      return sendError(res, badRequest(`No API key found for ${providerId}`));
    }

    try {
      if (providerId === 'openai') {
        const openai = new OpenAI({ apiKey: key });
        await openai.models.list();
      } else if (providerId === 'grok') {
        const groq = new Groq({ apiKey: key });
        await groq.models.list();
      } else if (providerId === 'gemini') {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await model.generateContent('Hi');
      } else if (providerId === 'claude') {
        const client = new Anthropic({ apiKey: key });
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });
      } else {
        return sendError(res, badRequest(`Unknown provider: ${providerId}`));
      }

      return sendSuccess(res, { message: `${KNOWN_PROVIDER_LABELS[providerId] || providerId} connected successfully` });
    } catch (err) {
      log.warn(`Provider test failed: ${providerId}`, { error: err.message });
      return sendError(res, badRequest(err.message));
    }
  }

  // ── Platform info ─────────────────────────────────────

  getPlatformInfo(req, res, next) {
    const os = process.platform;
    const arch = process.arch;
    const isAppleSilicon = os === 'darwin' && arch === 'arm64';
    const backend = isAppleSilicon ? 'mlx' : 'local';

    return sendSuccess(res, {
      platform: os,
      arch,
      isAppleSilicon,
      recommendedBackend: backend,
      whisperCacheDir: os === 'win32'
        ? '%USERPROFILE%\\.cache\\whisper'
        : os === 'darwin'
          ? '~/.cache/whisper'
          : '~/.cache/whisper',
    });
  }

  // ── Whisper model management ─────────────────────────

  async getWhisperModels(req, res, next) {
    try {
      const resp = await fetch('http://localhost:8000/whisper-models', { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      return sendSuccess(res, { models: data.models || [] });
    } catch {
      const models = ['tiny', 'base', 'small', 'medium', 'large'].map(name => ({
        name,
        downloaded: null,
        sizeLabel: { tiny: '~75 MB', base: '~145 MB', small: '~465 MB', medium: '~1.5 GB', large: '~2.9 GB' }[name],
      }));
      return sendSuccess(res, { models, transcriber_offline: true });
    }
  }

  async downloadWhisperModel(req, res, next) {
    const { model } = req.body;
    if (!['tiny', 'base', 'small', 'medium', 'large'].includes(model)) {
      return sendError(res, badRequest('Invalid model name'));
    }
    try {
      const resp = await fetch('http://localhost:8000/download-whisper-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      return sendSuccess(res, data);
    } catch {
      return sendError(res, badRequest('Transcriber not running. Start the app first.'));
    }
  }

  // ── Telemetry: read current config ────────────────────

  getTelemetryStatus(req, res, next) {
    this._reloadEnv();
    const t = {
      enabled:       process.env.TELEMETRY_ENABLED === 'true',
      otlp_endpoint: process.env.OTLP_ENDPOINT              || '',
      instance_id:   process.env.GRAFANA_INSTANCE_ID         || '',
      access_token:  process.env.GRAFANA_ACCESS_TOKEN        || '',
      service_prefix:process.env.TELEMETRY_SERVICE_PREFIX    || 'solvewatch',
      grafana_url:   process.env.GRAFANA_URL                 || '',
      grafana_sa_token: process.env.GRAFANA_SA_TOKEN         || '',
    };
    return sendSuccess(res, {
      enabled:        t.enabled && isTelemetryEnabled(),
      configured:     t.enabled,
      otlp_endpoint:  t.otlp_endpoint || 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp',
      service_prefix: t.service_prefix,
      instance_id:    t.instance_id,
      auth_token_set: !!(t.access_token && t.access_token.trim()),
      host_owner:     process.env.HOST_OWNER || '',
      grafana_url:    t.grafana_url,
      grafana_sa_token_set: !!(t.grafana_sa_token && t.grafana_sa_token.trim()),
      grafana_dashboard_url: process.env.GRAFANA_DASHBOARD_URL || '',
    });
  }

  // ── Telemetry: validate + persist + reload ────────────

  async saveAndReloadTelemetry(req, res, next) {
    const body = req.body || {};
    const enable        = !!body.enabled;
    const otlpEndpoint  = (body.otlp_endpoint  || '').trim();
    const servicePrefix = (body.service_prefix || 'solvewatch').trim() || 'solvewatch';
    const instanceId    = (body.instance_id    || '').trim();
    const hostOwner     = (body.host_owner     || '').trim();
    let   accessToken   = (body.access_token   || body.auth_token || '').trim();

    this._reloadEnv();
    const existingToken = process.env.GRAFANA_ACCESS_TOKEN || '';
    if (accessToken === '***') accessToken = existingToken;

    const buildHeader = () => {
      if (instanceId && accessToken) {
        const b64 = Buffer.from(`${instanceId}:${accessToken}`, 'utf8').toString('base64');
        return `Basic ${b64}`;
      }
      if (!accessToken) return '';
      if (accessToken.startsWith('Bearer ') || accessToken.startsWith('Basic ')) return accessToken;
      return `Bearer ${accessToken}`;
    };

    // Disable path
    if (!enable) {
      const updates = { TELEMETRY_ENABLED: 'false' };
      if (otlpEndpoint) updates.OTLP_ENDPOINT = otlpEndpoint;
      if (instanceId)   updates.GRAFANA_INSTANCE_ID = instanceId;
      if (accessToken)  updates.GRAFANA_ACCESS_TOKEN = accessToken;
      if (servicePrefix) updates.TELEMETRY_SERVICE_PREFIX = servicePrefix;
      if (hostOwner)    updates.HOST_OWNER = hostOwner;
      this._writeDotEnvKeys(updates);
      try { await shutdownTelemetry(); } catch {}
      this._reloadPythonTelemetry().catch(() => {});
      log.info('Telemetry disabled via settings');
      return sendSuccess(res, { enabled: false, message: 'Telemetry disabled.' });
    }

    // Enable path: validate first
    if (!otlpEndpoint) return sendError(res, badRequest('OTLP endpoint is required.'));
    if (!accessToken)  return sendError(res, badRequest('Access policy token is required.'));
    if (!instanceId)   return sendError(res, badRequest('Instance ID is required (Grafana Cloud uses Basic auth: instanceID:token).'));

    const headerToken = buildHeader();
    log.info('Validating OTLP endpoint', { endpoint: otlpEndpoint, instanceId });
    const probe = await validateOtlpEndpoint(otlpEndpoint, headerToken);

    if (!probe.ok) {
      this._writeDotEnvKeys({
        TELEMETRY_ENABLED:       'false',
        OTLP_ENDPOINT:            otlpEndpoint,
        GRAFANA_INSTANCE_ID:      instanceId,
        GRAFANA_ACCESS_TOKEN:     accessToken,
        TELEMETRY_SERVICE_PREFIX: servicePrefix,
        ...(hostOwner ? { HOST_OWNER: hostOwner } : {}),
      });
      try { await shutdownTelemetry(); } catch {}
      const reasonMsg = {
        bad_token:   'Authentication failed (HTTP 401/403). Check Instance ID + token (token must have metrics:write + logs:write).',
        not_found:   'Endpoint not found (HTTP 404). Check the OTLP endpoint URL.',
        unreachable: `Could not reach the endpoint: ${probe.error || 'network error'}.`,
      }[probe.reason] || `Endpoint returned HTTP ${probe.status}.`;
      log.warn('Telemetry validation failed — staying disabled', { reason: probe.reason, status: probe.status });
      return sendError(res, badRequest(reasonMsg));
    }

    // Validation passed → persist enabled=true and reload
    this._writeDotEnvKeys({
      TELEMETRY_ENABLED:       'true',
      OTLP_ENDPOINT:            otlpEndpoint,
      GRAFANA_INSTANCE_ID:      instanceId,
      GRAFANA_ACCESS_TOKEN:     accessToken,
      TELEMETRY_SERVICE_PREFIX: servicePrefix,
      ...(hostOwner ? { HOST_OWNER: hostOwner } : {}),
    });

    const cfg = {
      telemetry: {
        enabled: true,
        otlp_endpoint:  otlpEndpoint,
        instance_id:    instanceId,
        access_token:   accessToken,
        service_prefix: servicePrefix,
      },
      host_owner: hostOwner || process.env.HOST_OWNER || '',
    };

    try {
      await initTelemetry(cfg);
      if (isTelemetryEnabled()) startSystemMetricsSampler(10).catch(() => {});
    } catch (e) {
      log.error('Telemetry reinit failed', { error: e.message });
      return sendError(res, internal(`Reload failed: ${e.message}`));
    }
    const pyResult = await this._reloadPythonTelemetry();

    log.info('Telemetry enabled via settings', { endpoint: otlpEndpoint, prefix: servicePrefix, python: pyResult });
    return sendSuccess(res, {
      enabled: true, validation: probe, python: pyResult,
      message: 'Telemetry validated and enabled.',
    });
  }

  async _reloadPythonTelemetry() {
    try {
      const resp = await fetch('http://localhost:8000/reload-telemetry', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      const body = await resp.json().catch(() => ({}));
      return { ok: resp.ok, ...body };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ── Dashboard auto-import to Grafana ──────────────────

  async importDashboardToGrafana(req, res, next) {
    const body = req.body || {};
    const grafanaUrl = (body.grafana_url || '').trim().replace(/\/+$/, '');
    let saToken      = (body.sa_token    || '').trim();

    this._reloadEnv();
    if (saToken === '***') saToken = process.env.GRAFANA_SA_TOKEN || '';

    if (!grafanaUrl) return sendError(res, badRequest('Grafana URL is required (e.g., https://my-stack.grafana.net)'));
    if (!saToken)   return sendError(res, badRequest('Service Account token is required (starts with glsa_…)'));

    const headers = { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' };

    // 1. Validate token + discover data sources
    let datasources;
    try {
      const r = await fetch(`${grafanaUrl}/api/datasources`, { headers, signal: AbortSignal.timeout(10000) });
      if (r.status === 401 || r.status === 403) {
        return sendSuccess(res, { success: false, error: 'Service Account token rejected (HTTP ' + r.status + '). Token needs Editor role + dashboards:write scope.' });
      }
      if (!r.ok) {
        return sendSuccess(res, { success: false, error: `Grafana returned HTTP ${r.status} for /api/datasources. Check the URL.` });
      }
      datasources = await r.json();
    } catch (err) {
      return sendSuccess(res, { success: false, error: `Could not reach Grafana: ${err.message}` });
    }

    const prom = datasources.find((d) => d.type === 'prometheus' && /prom/i.test(d.name)) || datasources.find((d) => d.type === 'prometheus');
    const loki = datasources.find((d) => d.type === 'loki');
    if (!prom) return sendSuccess(res, { success: false, error: 'No Prometheus data source found in this Grafana stack.' });
    if (!loki) return sendSuccess(res, { success: false, error: 'No Loki data source found in this Grafana stack.' });

    // 2. Read dashboard JSON + substitute placeholders
    let dashboard;
    try {
      const dashPath = path.join(process.cwd(), 'docs', 'grafana-dashboard.json');
      const raw = fs.readFileSync(dashPath, 'utf8')
        .replaceAll('${DS_PROMETHEUS}', prom.uid)
        .replaceAll('${DS_LOKI}',       loki.uid);
      dashboard = JSON.parse(raw);
      delete dashboard.__inputs;
      delete dashboard.__requires;
      dashboard.id = null;
    } catch (err) {
      return sendError(res, internal(`Could not read dashboard JSON: ${err.message}`));
    }

    // 3. POST to Grafana
    let result;
    try {
      const r = await fetch(`${grafanaUrl}/api/dashboards/db`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          dashboard,
          overwrite: true,
          message: 'Imported via SolveWatch settings page',
          folderUid: '',
        }),
        signal: AbortSignal.timeout(15000),
      });
      result = await r.json().catch(() => ({}));
      if (!r.ok) {
        return sendSuccess(res, { success: false, error: result.message || `Grafana returned HTTP ${r.status} on dashboard import.` });
      }
    } catch (err) {
      return sendSuccess(res, { success: false, error: `Dashboard import failed: ${err.message}` });
    }

    // 4. Persist Grafana URL + SA token
    try {
      this._writeDotEnvKeys({ GRAFANA_URL: grafanaUrl, GRAFANA_SA_TOKEN: saToken });
    } catch (e) {
      log.warn('Could not persist grafana fields', { error: e.message });
    }

    const dashboardUrl = `${grafanaUrl}${result.url || `/d/${result.uid}`}`;
    log.info('Dashboard imported to Grafana', { uid: result.uid, url: dashboardUrl });
    try { this._writeDotEnvKeys({ GRAFANA_DASHBOARD_URL: dashboardUrl }); } catch (_) {}
    return sendSuccess(res, {
      url:            dashboardUrl,
      uid:            result.uid,
      version:        result.version,
      datasources:    { prometheus: prom.name, loki: loki.name },
      message:        'Dashboard imported successfully.',
    });
  }
}

export default new ConfigController();
