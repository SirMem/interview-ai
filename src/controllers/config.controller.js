import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger.js';
import {
  initTelemetry,
  shutdownTelemetry,
  startSystemMetricsSampler,
  validateOtlpEndpoint,
  isEnabled as isTelemetryEnabled,
} from '../utils/telemetry.js';

const log = logger('ConfigController');

const CONFIG_FILE_PATH = path.join(process.cwd(), 'config', 'api-keys.json');

const KNOWN_PROVIDER_LABELS = {
  openai: 'OpenAI',
  grok: 'Grok (Groq)',
  gemini: 'Gemini',
  claude: 'Claude (Anthropic)',
  ollama: 'Ollama (local)',
};

// Fallback model lists per provider (used when live fetch fails or as initial options)
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
  ollama: [
    { id: 'llama3.2:1b', name: 'Llama 3.2 1B (fast)' },
    { id: 'llama3.2:3b', name: 'Llama 3.2 3B' },
    { id: 'llama3.1:8b', name: 'Llama 3.1 8B' },
    { id: 'qwen2.5:3b',  name: 'Qwen 2.5 3B' },
    { id: 'qwen2.5:7b',  name: 'Qwen 2.5 7B' },
  ],
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  grok: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-5',
};

class ConfigController {
  getConfigFilePath() {
    const configDir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return CONFIG_FILE_PATH;
  }

  _readConfig() {
    const configPath = this.getConfigFilePath();
    if (!fs.existsSync(configPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return null;
    }
  }

  // ── Legacy endpoints (kept for backwards compat) ──────────────────

  getApiKeys(req, res) {
    try {
      const config = this._readConfig();
      if (!config) return res.json({ success: true, config: null });

      const maskedKeys = {};
      if (config.keys) {
        Object.keys(config.keys).forEach((id) => {
          maskedKeys[id] = config.keys[id] ? '***' : '';
        });
      }

      res.json({
        success: true,
        config: {
          keys: maskedKeys,
          order: config.order || [],
          enabled: config.enabled || config.order || [],
        },
      });
    } catch (err) {
      log.error('Error reading API keys config', err);
      res.status(500).json({ success: false, error: 'Failed to read configuration' });
    }
  }

  saveApiKeys(req, res) {
    try {
      const { keys, order, enabled } = req.body;
      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ success: false, error: 'Invalid configuration format' });
      }

      const configPath = this.getConfigFilePath();
      let existingConfig = { keys: {}, order: [], enabled: [] };
      if (fs.existsSync(configPath)) {
        try { existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      }

      const mergedKeys = { ...existingConfig.keys };
      if (keys) {
        Object.keys(keys).forEach((id) => {
          const newKey = keys[id]?.trim();
          if (newKey && newKey !== '***') mergedKeys[id] = newKey;
        });
      }

      const enabledProviders =
        enabled && Array.isArray(enabled)
          ? enabled
          : order.filter((id) => mergedKeys[id]?.trim());

      // Zero enabled remote providers is legal now: Ollama is the terminal fallback.
      const configToSave = { ...existingConfig, keys: mergedKeys, order, enabled: enabledProviders };
      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');

      const maskedKeys = {};
      Object.keys(configToSave.keys).forEach((id) => {
        maskedKeys[id] = configToSave.keys[id] ? '***' : '';
      });

      res.json({ success: true, message: 'Configuration saved', config: { keys: maskedKeys, order, enabled: enabledProviders } });
    } catch (err) {
      log.error('Error saving API keys config', err);
      res.status(500).json({ success: false, error: 'Failed to save configuration' });
    }
  }

  // ── Full settings read ─────────────────────────────────────────────

  getFullConfig(req, res) {
    try {
      const config = this._readConfig() || { keys: {}, order: [], enabled: [] };

      const allKnownIds = ['openai', 'grok', 'gemini', 'claude', 'ollama'];
      const existingIds = new Set([
        ...(config.order || []),
        ...Object.keys(config.keys || {}).filter(k => k !== 'ollama_model'),
      ]);
      // Merge known providers in; keep existing order, append unknown known ones at end
      const allIds = [...new Set([...allKnownIds, ...existingIds])].filter(id => id !== 'ollama_model');

      // Build ordered list: configured order first, then unordered known providers
      const orderedIds = [
        ...(config.order || []).filter(id => id !== 'ollama_model'),
        ...allIds.filter(id => !(config.order || []).includes(id)),
      ];

      // Ollama is always enabled by default (local fallback). Only disable it
      // if the user explicitly set ollama_enabled=false.
      const enabledSet = new Set(config.enabled || config.order || []);
      if (config.ollama_enabled !== false) enabledSet.add('ollama');
      const providers = orderedIds.map(id => ({
        id,
        label: KNOWN_PROVIDER_LABELS[id] || id,
        // ollama never needs an API key — treat as permanently "configured"
        hasKey: id === 'ollama' ? true : !!(config.keys?.[id]),
        local:  id === 'ollama',
        enabled: enabledSet.has(id),
        model: id === 'ollama'
          ? (config.ollama_model || 'llama3.2:1b')
          : (config.models?.[id] || DEFAULT_MODELS[id] || ''),
      }));

      res.json({
        success: true,
        providers,
        stt_model:            config.stt_model            || 'small',
        answer_mode:          config.answer_mode           || 'auto',
        hud_opacity:          config.hud_opacity           ?? 15,
        screenshots_path:     config.screenshots_path      || '',
        interview_role:       config.interview_role        || '',
        speaker_id_threshold: config.speaker_id_threshold  ?? 0.70,
        speaker_id_enabled:   config.speaker_id_enabled    ?? false,
      });
    } catch (err) {
      log.error('Error reading full config', err);
      res.status(500).json({ success: false, error: 'Failed to read configuration' });
    }
  }

  // ── Full settings save ─────────────────────────────────────────────

  saveFullConfig(req, res) {
    try {
      const { providers, stt_model, answer_mode, hud_opacity, screenshots_path, interview_role, speaker_id_threshold, speaker_id_enabled } = req.body;

      const configPath = this.getConfigFilePath();
      let existingConfig = { keys: {}, order: [], enabled: [] };
      if (fs.existsSync(configPath)) {
        try { existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      }

      // Merge provider keys + models
      const mergedKeys = { ...existingConfig.keys };
      const mergedModels = { ...(existingConfig.models || {}) };
      const order = [];
      const enabledProviders = [];

      let ollamaEnabledOverride = null;  // null = don't change; bool = set explicitly
      let ollamaModelOverride   = null;
      if (Array.isArray(providers)) {
        for (const p of providers) {
          if (!p.id) continue;
          if (p.id === 'ollama') {
            // ollama lives in its own top-level fields, not in order/keys/models.
            ollamaEnabledOverride = !!p.enabled;
            if (p.model && p.model.trim()) ollamaModelOverride = p.model.trim();
            continue;
          }
          order.push(p.id);
          if (p.enabled) enabledProviders.push(p.id);
          // Only update key if a non-blank, non-placeholder value is provided
          if (p.key && p.key.trim() && p.key !== '***') {
            mergedKeys[p.id] = p.key.trim();
          }
          // Save selected model
          if (p.model && p.model.trim()) {
            mergedModels[p.id] = p.model.trim();
          }
        }
      }

      // "At least one provider" rule is lifted: Ollama is always a terminal
      // fallback, so zero enabled remote providers is legal — the answer just
      // goes local.

      const configToSave = {
        ...existingConfig,           // preserve vad block and any other fields
        keys:             mergedKeys,
        models:           mergedModels,
        order:            order.length ? order : existingConfig.order,
        enabled:          enabledProviders.length ? enabledProviders : existingConfig.enabled,
        ollama_enabled:   ollamaEnabledOverride !== null
                            ? ollamaEnabledOverride
                            : (existingConfig.ollama_enabled !== false),
        ollama_model:     ollamaModelOverride  || existingConfig.ollama_model || 'llama3.2:1b',
        stt_model:            stt_model            || existingConfig.stt_model            || 'small',
        answer_mode:          answer_mode          || existingConfig.answer_mode           || 'auto',
        hud_opacity:          hud_opacity          ?? existingConfig.hud_opacity           ?? 15,
        screenshots_path:     screenshots_path     !== undefined ? screenshots_path     : (existingConfig.screenshots_path || ''),
        interview_role:       interview_role       !== undefined ? interview_role       : (existingConfig.interview_role   || ''),
        speaker_id_threshold: speaker_id_threshold !== undefined ? +speaker_id_threshold : (existingConfig.speaker_id_threshold ?? 0.70),
        speaker_id_enabled:   speaker_id_enabled   !== undefined ? !!speaker_id_enabled  : (existingConfig.speaker_id_enabled   ?? false),
      };
      // Drop the legacy hf_token field on save — speaker ID no longer needs it.
      if ('hf_token' in configToSave) delete configToSave.hf_token;

      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');
      log.info('Full config saved', { providers: order, stt_model, answer_mode });

      res.json({ success: true, message: 'Settings saved successfully' });
    } catch (err) {
      log.error('Error saving full config', err);
      res.status(500).json({ success: false, error: 'Failed to save configuration' });
    }
  }

  // ── Model list for a provider ──────────────────────────────────────

  async getProviderModels(req, res) {
    const { providerId } = req.params;
    const config = this._readConfig() || {};
    const apiKey = config.keys?.[providerId];

    // Always return fallback list; try live fetch as bonus
    const fallback = FALLBACK_MODELS[providerId] || [];

    // Ollama: fetch locally installed models from the daemon (no key needed).
    if (providerId === 'ollama') {
      try {
        const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          const data = await r.json();
          const models = (data.models || [])
            .map((m) => ({ id: m.name, name: m.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          if (models.length) return res.json({ success: true, models, source: 'live' });
        }
      } catch {
        // Ollama not running — fall through to fallback list
      }
      return res.json({ success: true, models: fallback, source: 'fallback' });
    }

    if (!apiKey) {
      return res.json({ success: true, models: fallback, source: 'fallback' });
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
        // Gemini doesn't have a list endpoint in the SDK; return fallback
        models = fallback;
      } else if (providerId === 'claude') {
        // Anthropic doesn't expose a public model list endpoint; return fallback
        models = fallback;
      } else {
        models = fallback;
      }

      if (models.length === 0) models = fallback;
      return res.json({ success: true, models, source: 'live' });
    } catch (err) {
      log.warn(`Could not fetch models for ${providerId}`, { error: err.message });
      return res.json({ success: true, models: fallback, source: 'fallback' });
    }
  }

  // ── Prompt preview ─────────────────────────────────────────────────

  getPromptPreview(req, res) {
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
        return res.status(400).json({ success: false, error: `Unknown prompt type: ${type}` });
      }

      const promptPath = path.join(process.cwd(), 'prompts', filename);
      let promptText = '';
      try {
        promptText = fs.readFileSync(promptPath, 'utf8').trim();
      } catch {
        return res.status(404).json({ success: false, error: 'Prompt file not found' });
      }

      // Inject role prefix the same way ai.service.js does
      const rolePrefix = role
        ? `## Interview Context\nRole: ${role}\nTailor your answer specifically for a ${role} interview — use relevant tools, frameworks, and terminology for this domain.\n\n`
        : '';

      res.json({
        success: true,
        type,
        role: role || null,
        prompt: rolePrefix + promptText,
      });
    } catch (err) {
      log.error('Error reading prompt preview', err);
      res.status(500).json({ success: false, error: 'Failed to read prompt' });
    }
  }

  // ── Test provider connection ───────────────────────────────────────

  async testProvider(req, res) {
    const { providerId, key: rawKey } = req.body;
    if (!providerId) {
      return res.status(400).json({ success: false, error: 'providerId is required' });
    }

    // Ollama: local daemon, no API key. Test connectivity to /api/tags.
    if (providerId === 'ollama') {
      try {
        const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
        if (!r.ok) return res.status(400).json({ success: false, error: `Ollama returned HTTP ${r.status}` });
        const data = await r.json();
        const count = (data.models || []).length;
        return res.json({ success: true, message: `Ollama running — ${count} model(s) installed` });
      } catch (err) {
        return res.status(400).json({ success: false, error: `Could not reach Ollama at localhost:11434 — start it with "ollama serve"` });
      }
    }

    // Use stored key if client sent placeholder or no key
    let key = rawKey;
    if (!key || key === '***' || key === '***STORED***') {
      const config = this._readConfig() || {};
      key = config.keys?.[providerId] || '';
    }

    if (!key) {
      return res.status(400).json({ success: false, error: `No API key found for ${providerId}` });
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
        return res.status(400).json({ success: false, error: `Unknown provider: ${providerId}` });
      }

      res.json({ success: true, message: `${KNOWN_PROVIDER_LABELS[providerId] || providerId} connected successfully` });
    } catch (err) {
      log.warn(`Provider test failed: ${providerId}`, { error: err.message });
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Platform info ──────────────────────────────────────────────────

  getPlatformInfo(req, res) {
    const os = process.platform;   // 'darwin', 'win32', 'linux'
    const arch = process.arch;     // 'arm64', 'x64', etc.
    const isAppleSilicon = os === 'darwin' && arch === 'arm64';
    const backend = isAppleSilicon ? 'mlx' : 'local';

    res.json({
      success: true,
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

  // ── Whisper model management ───────────────────────────────────────

  async getWhisperModels(req, res) {
    try {
      const resp = await fetch('http://localhost:8000/whisper-models', { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      return res.json({ success: true, models: data.models || [] });
    } catch {
      // Transcriber not running — return static list with unknown status
      const models = ['tiny', 'base', 'small', 'medium', 'large'].map(name => ({
        name,
        downloaded: null,
        sizeLabel: { tiny: '~75 MB', base: '~145 MB', small: '~465 MB', medium: '~1.5 GB', large: '~2.9 GB' }[name],
      }));
      return res.json({ success: true, models, transcriber_offline: true });
    }
  }

  async downloadWhisperModel(req, res) {
    const { model } = req.body;
    if (!['tiny', 'base', 'small', 'medium', 'large'].includes(model)) {
      return res.status(400).json({ success: false, error: 'Invalid model name' });
    }
    try {
      const resp = await fetch('http://localhost:8000/download-whisper-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      return res.json({ success: true, ...data });
    } catch {
      return res.status(503).json({ success: false, error: 'Transcriber not running. Start the app first.' });
    }
  }

  // ── Telemetry: read current config (no secrets exposed) ─────────────
  getTelemetryStatus(req, res) {
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    } catch {}
    const t = cfg.telemetry || {};
    return res.json({
      success: true,
      enabled:        !!t.enabled && isTelemetryEnabled(),     // both persisted AND actually running
      configured:     !!t.enabled,                              // just the persisted bit
      otlp_endpoint:  t.otlp_endpoint || 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp',
      service_prefix: t.service_prefix || 'solvewatch',
      instance_id:    t.instance_id   || '',
      auth_token_set: !!((t.access_token || t.auth_token) && (t.access_token || t.auth_token).trim()),
      host_owner:     cfg.host_owner  || '',  // top-level field, friendly machine label
      grafana_url:    t.grafana_url   || '',
      grafana_sa_token_set: !!(t.grafana_sa_token && t.grafana_sa_token.trim()),
    });
  }

  // ── Telemetry: validate + persist + reload both services ────────────
  async saveAndReloadTelemetry(req, res) {
    const body = req.body || {};
    const enable        = !!body.enabled;
    const otlpEndpoint  = (body.otlp_endpoint  || '').trim();
    const servicePrefix = (body.service_prefix || 'solvewatch').trim() || 'solvewatch';
    const instanceId    = (body.instance_id    || '').trim();
    const hostOwner     = (body.host_owner     || '').trim();
    let   accessToken   = (body.access_token   || body.auth_token || '').trim();  // accept legacy field too

    // Read existing config
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8')); } catch {}
    const existingToken = cfg.telemetry?.access_token || '';

    // Token sentinel: '***' means "keep existing".
    if (accessToken === '***') accessToken = existingToken;

    // Build the Authorization header value.
    //   - Grafana Cloud OTLP gateway:  Basic base64(instanceID:accessPolicyToken)
    //   - Anything else (e.g. self-hosted with bearer tokens): use raw token if
    //     it already includes a scheme, else fall back to Bearer.
    const buildHeader = () => {
      if (instanceId && accessToken) {
        const b64 = Buffer.from(`${instanceId}:${accessToken}`, 'utf8').toString('base64');
        return `Basic ${b64}`;
      }
      if (!accessToken) return '';
      if (accessToken.startsWith('Bearer ') || accessToken.startsWith('Basic ')) return accessToken;
      return `Bearer ${accessToken}`;
    };

    // ── Disable path: skip validation, just shut things down ──────────
    if (!enable) {
      cfg.telemetry = {
        enabled: false,
        otlp_endpoint:  otlpEndpoint  || cfg.telemetry?.otlp_endpoint  || '',
        instance_id:    instanceId    || cfg.telemetry?.instance_id    || '',
        access_token:   accessToken,
        service_prefix: servicePrefix,
      };
      // Drop legacy auth_token field if present.
      if ('auth_token' in cfg.telemetry) delete cfg.telemetry.auth_token;
      // host_owner lives at the top level — friendly machine label.
      if (hostOwner) cfg.host_owner = hostOwner;
      this._writeConfig(cfg);
      try { await shutdownTelemetry(); } catch {}
      this._reloadPythonTelemetry().catch(() => {});  // best-effort
      log.info('Telemetry disabled via settings');
      return res.json({ success: true, enabled: false, message: 'Telemetry disabled.' });
    }

    // ── Enable path: validate first, only persist enabled=true if it works ──
    if (!otlpEndpoint) {
      return res.status(400).json({ success: false, error: 'OTLP endpoint is required.' });
    }
    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Access policy token is required.' });
    }
    if (!instanceId) {
      return res.status(400).json({ success: false, error: 'Instance ID is required (Grafana Cloud uses Basic auth: instanceID:token).' });
    }

    const headerToken = buildHeader();
    log.info('Validating OTLP endpoint', { endpoint: otlpEndpoint, instanceId });
    const probe = await validateOtlpEndpoint(otlpEndpoint, headerToken);

    if (!probe.ok) {
      // Persist with enabled=false so the next restart doesn't try a bad config.
      cfg.telemetry = {
        enabled: false,
        otlp_endpoint:  otlpEndpoint,
        instance_id:    instanceId,
        access_token:   accessToken,    // keep what they typed so they can fix it
        service_prefix: servicePrefix,
      };
      if (hostOwner) cfg.host_owner = hostOwner;
      this._writeConfig(cfg);
      try { await shutdownTelemetry(); } catch {}
      const reasonMsg = {
        bad_token:   'Authentication failed (HTTP 401/403). Check Instance ID + token (token must have metrics:write + logs:write).',
        not_found:   'Endpoint not found (HTTP 404). Check the OTLP endpoint URL.',
        unreachable: `Could not reach the endpoint: ${probe.error || 'network error'}.`,
      }[probe.reason] || `Endpoint returned HTTP ${probe.status}.`;
      log.warn('Telemetry validation failed — staying disabled', { reason: probe.reason, status: probe.status });
      return res.json({
        success: false,
        enabled: false,
        validation: probe,
        error: reasonMsg,
      });
    }

    // ── Validation passed → persist enabled=true and reload exporters ─
    cfg.telemetry = {
      enabled: true,
      otlp_endpoint:  otlpEndpoint,
      instance_id:    instanceId,
      access_token:   accessToken,
      service_prefix: servicePrefix,
    };
    if ('auth_token' in cfg.telemetry) delete cfg.telemetry.auth_token;
    if (hostOwner) cfg.host_owner = hostOwner;
    this._writeConfig(cfg);

    try {
      await initTelemetry(cfg);                         // re-entrant: tears down old + starts new
      if (isTelemetryEnabled()) startSystemMetricsSampler(10).catch(() => {});
    } catch (e) {
      log.error('Telemetry reinit failed', { error: e.message });
      return res.status(500).json({ success: false, error: `Reload failed: ${e.message}` });
    }
    // Best-effort: ask Python transcriber to reload too
    const pyResult = await this._reloadPythonTelemetry();

    log.info('Telemetry enabled via settings', { endpoint: otlpEndpoint, prefix: servicePrefix, python: pyResult });
    return res.json({
      success: true,
      enabled: true,
      validation: probe,
      python: pyResult,
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
      // Transcriber may not be up yet — that's OK, it'll pick up the config on next start.
      return { ok: false, error: e.message };
    }
  }

  _writeConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  }

  // ── Dashboard auto-import to Grafana ──────────────────────────────────────
  // Body: { grafana_url: 'https://my-stack.grafana.net', sa_token: 'glsa_...' }
  // Steps: validate token → discover Prometheus + Loki UIDs → substitute into
  // dashboard JSON → POST /api/dashboards/db. Response includes URL to view.
  async importDashboardToGrafana(req, res) {
    const body = req.body || {};
    const grafanaUrl = (body.grafana_url || '').trim().replace(/\/+$/, '');
    let saToken      = (body.sa_token    || '').trim();

    // Persist+restore the SA token so users don't paste it every time. '***' = keep existing.
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8')); } catch {}
    cfg.telemetry = cfg.telemetry || {};
    if (saToken === '***') saToken = cfg.telemetry.grafana_sa_token || '';

    if (!grafanaUrl) return res.status(400).json({ success: false, error: 'Grafana URL is required (e.g., https://my-stack.grafana.net)' });
    if (!saToken)   return res.status(400).json({ success: false, error: 'Service Account token is required (starts with glsa_…)' });

    const headers = { 'Authorization': `Bearer ${saToken}`, 'Content-Type': 'application/json' };

    // 1. Validate token + discover data sources
    let datasources;
    try {
      const r = await fetch(`${grafanaUrl}/api/datasources`, { headers, signal: AbortSignal.timeout(10000) });
      if (r.status === 401 || r.status === 403) {
        return res.json({ success: false, error: 'Service Account token rejected (HTTP ' + r.status + '). Token needs Editor role + dashboards:write scope.' });
      }
      if (!r.ok) {
        return res.json({ success: false, error: `Grafana returned HTTP ${r.status} for /api/datasources. Check the URL.` });
      }
      datasources = await r.json();
    } catch (err) {
      return res.json({ success: false, error: `Could not reach Grafana: ${err.message}` });
    }

    const prom = datasources.find((d) => d.type === 'prometheus' && /prom/i.test(d.name)) || datasources.find((d) => d.type === 'prometheus');
    const loki = datasources.find((d) => d.type === 'loki');
    if (!prom) return res.json({ success: false, error: 'No Prometheus data source found in this Grafana stack.' });
    if (!loki) return res.json({ success: false, error: 'No Loki data source found in this Grafana stack.' });

    // 2. Read dashboard JSON + substitute placeholders
    let dashboard;
    try {
      const dashPath = path.join(process.cwd(), 'docs', 'grafana-dashboard.json');
      const raw = fs.readFileSync(dashPath, 'utf8')
        .replaceAll('${DS_PROMETHEUS}', prom.uid)
        .replaceAll('${DS_LOKI}',       loki.uid);
      dashboard = JSON.parse(raw);
      // Strip import-wizard markers so Grafana accepts it as a real dashboard.
      delete dashboard.__inputs;
      delete dashboard.__requires;
      // Force a fresh creation rather than version-overwrite when uid collides.
      dashboard.id = null;
    } catch (err) {
      return res.status(500).json({ success: false, error: `Could not read dashboard JSON: ${err.message}` });
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
        return res.json({ success: false, error: result.message || `Grafana returned HTTP ${r.status} on dashboard import.` });
      }
    } catch (err) {
      return res.json({ success: false, error: `Dashboard import failed: ${err.message}` });
    }

    // 4. Persist Grafana URL + SA token for next time
    cfg.telemetry.grafana_url      = grafanaUrl;
    cfg.telemetry.grafana_sa_token = saToken;
    try { this._writeConfig(cfg); } catch (e) { log.warn('Could not persist grafana fields', { error: e.message }); }

    const dashboardUrl = `${grafanaUrl}${result.url || `/d/${result.uid}`}`;
    log.info('Dashboard imported to Grafana', { uid: result.uid, url: dashboardUrl });
    return res.json({
      success:        true,
      url:            dashboardUrl,
      uid:            result.uid,
      version:        result.version,
      datasources:    { prometheus: prom.name, loki: loki.name },
      message:        'Dashboard imported successfully.',
    });
  }
}

export default new ConfigController();
