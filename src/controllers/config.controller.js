import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const log = logger('ConfigController');

const CONFIG_FILE_PATH = path.join(
  process.cwd(),
  'config',
  'api-keys.json',
);

// Known providers with display labels
const KNOWN_PROVIDER_LABELS = {
  openai: 'OpenAI',
  grok: 'Grok',
  gemini: 'Gemini',
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

      const allProviderIds = new Set([
        ...(config.order || []),
        ...Object.keys(config.keys || {}).filter(k => k !== 'ollama_model'),
      ]);

      const enabledSet = new Set(config.enabled || config.order || []);
      const providers = [...allProviderIds]
        .filter(id => id !== 'ollama_model')
        .map(id => ({
          id,
          label: KNOWN_PROVIDER_LABELS[id] || id,
          hasKey: !!(config.keys?.[id]),
          enabled: enabledSet.has(id),
        }));

      res.json({
        success: true,
        providers,
        stt_model:       config.stt_model       || 'small',
        answer_mode:     config.answer_mode      || 'auto',
        hud_opacity:     config.hud_opacity      ?? 15,
        vad: {
          engine:                        config.vad?.engine                        ?? 'webrtc',
          energy_gate_threshold:         config.vad?.energy_gate_threshold         ?? 0.02,
          speech_frame_ratio:            config.vad?.speech_frame_ratio            ?? 0.7,
          min_speech_duration:           config.vad?.min_speech_duration           ?? 0.75,
          silence_threshold:             config.vad?.silence_threshold             ?? 1.0,
          max_utterance_duration:        config.vad?.max_utterance_duration        ?? 30.0,
          min_word_count:                config.vad?.min_word_count                ?? 3,
          silero_threshold:              config.vad?.silero_threshold              ?? 0.5,
          silero_min_speech_duration_ms: config.vad?.silero_min_speech_duration_ms ?? 250,
          silero_min_silence_duration_ms:config.vad?.silero_min_silence_duration_ms ?? 100,
        },
      });
    } catch (err) {
      log.error('Error reading full config', err);
      res.status(500).json({ success: false, error: 'Failed to read configuration' });
    }
  }

  // ── Full settings save ─────────────────────────────────────────────

  saveFullConfig(req, res) {
    try {
      const { providers, stt_model, answer_mode, hud_opacity, vad } = req.body;

      const configPath = this.getConfigFilePath();
      let existingConfig = { keys: {}, order: [], enabled: [] };
      if (fs.existsSync(configPath)) {
        try { existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      }

      // Merge provider keys
      const mergedKeys = { ...existingConfig.keys };
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
        }
      }

      if (enabledProviders.length === 0 && order.length > 0) {
        return res.status(400).json({ success: false, error: 'At least one provider must be enabled' });
      }

      const configToSave = {
        keys:             mergedKeys,
        order:            order.length ? order : existingConfig.order,
        enabled:          enabledProviders.length ? enabledProviders : existingConfig.enabled,
        stt_model:        stt_model        || existingConfig.stt_model       || 'small',
        answer_mode:      answer_mode      || existingConfig.answer_mode      || 'auto',
        hud_opacity:      hud_opacity      ?? existingConfig.hud_opacity      ?? 15,
        vad: {
          engine:                        vad?.engine                        ?? existingConfig.vad?.engine                        ?? 'webrtc',
          energy_gate_threshold:         vad?.energy_gate_threshold         ?? existingConfig.vad?.energy_gate_threshold         ?? 0.02,
          speech_frame_ratio:            vad?.speech_frame_ratio            ?? existingConfig.vad?.speech_frame_ratio            ?? 0.7,
          min_speech_duration:           vad?.min_speech_duration           ?? existingConfig.vad?.min_speech_duration           ?? 0.75,
          silence_threshold:             vad?.silence_threshold             ?? existingConfig.vad?.silence_threshold             ?? 1.0,
          max_utterance_duration:        vad?.max_utterance_duration        ?? existingConfig.vad?.max_utterance_duration        ?? 30.0,
          min_word_count:                vad?.min_word_count                ?? existingConfig.vad?.min_word_count                ?? 3,
          silero_threshold:              vad?.silero_threshold              ?? existingConfig.vad?.silero_threshold              ?? 0.5,
          silero_min_speech_duration_ms: vad?.silero_min_speech_duration_ms ?? existingConfig.vad?.silero_min_speech_duration_ms ?? 250,
          silero_min_silence_duration_ms:vad?.silero_min_silence_duration_ms?? existingConfig.vad?.silero_min_silence_duration_ms ?? 100,
        },
      };

      fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf8');
      log.info('Full config saved', { providers: order, stt_model, answer_mode });

      res.json({ success: true, message: 'Settings saved successfully' });
    } catch (err) {
      log.error('Error saving full config', err);
      res.status(500).json({ success: false, error: 'Failed to save configuration' });
    }
  }
}

export default new ConfigController();
