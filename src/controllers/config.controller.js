import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import Groq from 'groq-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger.js';

const log = logger('ConfigController');

const CONFIG_FILE_PATH = path.join(process.cwd(), 'config', 'api-keys.json');

const KNOWN_PROVIDER_LABELS = {
  openai: 'OpenAI',
  grok: 'Grok (Groq)',
  gemini: 'Gemini',
  claude: 'Claude (Anthropic)',
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

      if (enabledProviders.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one provider must be enabled' });
      }

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

      const allKnownIds = ['openai', 'grok', 'gemini', 'claude'];
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

      const enabledSet = new Set(config.enabled || config.order || []);
      const providers = orderedIds.map(id => ({
        id,
        label: KNOWN_PROVIDER_LABELS[id] || id,
        hasKey: !!(config.keys?.[id]),
        enabled: enabledSet.has(id),
        model: config.models?.[id] || DEFAULT_MODELS[id] || '',
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
        hf_token_set:         !!(config.hf_token),
      });
    } catch (err) {
      log.error('Error reading full config', err);
      res.status(500).json({ success: false, error: 'Failed to read configuration' });
    }
  }

  // ── Full settings save ─────────────────────────────────────────────

  saveFullConfig(req, res) {
    try {
      const { providers, stt_model, answer_mode, hud_opacity, screenshots_path, interview_role, speaker_id_threshold, speaker_id_enabled, hf_token } = req.body;

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

      if (Array.isArray(providers)) {
        for (const p of providers) {
          if (!p.id) continue;
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

      if (enabledProviders.length === 0 && order.length > 0) {
        return res.status(400).json({ success: false, error: 'At least one provider must be enabled' });
      }

      const configToSave = {
        ...existingConfig,           // preserve vad block and any other fields
        keys:             mergedKeys,
        models:           mergedModels,
        order:            order.length ? order : existingConfig.order,
        enabled:          enabledProviders.length ? enabledProviders : existingConfig.enabled,
        stt_model:            stt_model            || existingConfig.stt_model            || 'small',
        answer_mode:          answer_mode          || existingConfig.answer_mode           || 'auto',
        hud_opacity:          hud_opacity          ?? existingConfig.hud_opacity           ?? 15,
        screenshots_path:     screenshots_path     !== undefined ? screenshots_path     : (existingConfig.screenshots_path || ''),
        interview_role:       interview_role       !== undefined ? interview_role       : (existingConfig.interview_role   || ''),
        speaker_id_threshold: speaker_id_threshold !== undefined ? +speaker_id_threshold : (existingConfig.speaker_id_threshold ?? 0.70),
        speaker_id_enabled:   speaker_id_enabled   !== undefined ? !!speaker_id_enabled  : (existingConfig.speaker_id_enabled   ?? false),
        hf_token:             (hf_token && hf_token.trim() && hf_token !== '***') ? hf_token.trim() : (existingConfig.hf_token || ''),
      };

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
}

export default new ConfigController();
