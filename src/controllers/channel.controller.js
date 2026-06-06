/**
 * Channel Controller — REST API for channel CRUD and testing.
 *
 * All routes are mounted under /api/channels.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import channelService from '../services/channel.service.js';
import logger from '../utils/logger.js';

const log = logger('ChannelController');

class ChannelController {

  // ── List all channels ──────────────────────────────────────────────
  list(req, res) {
    try {
      const channels = channelService.getAll();
      res.json({ success: true, channels });
    } catch (err) {
      log.error('Error listing channels', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── Get a single channel ──────────────────────────────────────────
  get(req, res) {
    try {
      const ch = channelService.getByName(req.params.name);
      if (!ch) return res.status(404).json({ success: false, error: `Channel "${req.params.name}" not found` });
      res.json({ success: true, channel: ch });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── Create a channel ──────────────────────────────────────────────
  create(req, res) {
    try {
      const { name, serviceType, baseUrl, apiKeys, model, priority, status } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'name is required' });
      if (!serviceType) return res.status(400).json({ success: false, error: 'serviceType is required' });

      const channel = channelService.addChannel({
        name, serviceType, baseUrl, apiKeys,
        model: model || '',
        priority: priority ?? undefined,
        status: status || 'active',
      });
      res.status(201).json({ success: true, channel });
    } catch (err) {
      if (err.message.includes('already exists')) {
        return res.status(409).json({ success: false, error: err.message });
      }
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Update a channel ──────────────────────────────────────────────
  update(req, res) {
    try {
      const updates = {};
      for (const key of ['name', 'serviceType', 'baseUrl', 'apiKeys', 'model', 'priority', 'status']) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const channel = channelService.updateChannel(req.params.name, updates);
      res.json({ success: true, channel });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Delete a channel ──────────────────────────────────────────────
  delete(req, res) {
    try {
      channelService.deleteChannel(req.params.name);
      res.json({ success: true });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── Set channel status (pause / resume) ───────────────────────────
  setStatus(req, res) {
    try {
      const { status } = req.body;
      if (!['active', 'paused', 'disabled'].includes(status)) {
        return res.status(400).json({ success: false, error: 'status must be active, paused, or disabled' });
      }
      const channel = channelService.setStatus(req.params.name, status);
      res.json({ success: true, channel });
    } catch (err) {
      if (err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Reorder channels ──────────────────────────────────────────────
  reorder(req, res) {
    try {
      const { names } = req.body;
      if (!Array.isArray(names)) {
        return res.status(400).json({ success: false, error: 'names array is required' });
      }
      channelService.reorder(names);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // ── Test channel connectivity ─────────────────────────────────────
  async test(req, res) {
    try {
      const { name, apiKey } = req.body;
      let channel;

      if (name) {
        channel = channelService.getByName(name);
        if (!channel) return res.status(404).json({ success: false, error: `Channel "${name}" not found` });
      } else {
        // Test with body params (ad-hoc test, no channel saved)
        const { serviceType, baseUrl } = req.body;
        if (!serviceType) return res.status(400).json({ success: false, error: 'serviceType or name is required' });
        channel = { serviceType, baseUrl, apiKeys: [apiKey || ''], model: req.body.model || '' };
      }

      const key = apiKey || channel.apiKeys[0];
      if (!key) return res.status(400).json({ success: false, error: 'No API key available for testing' });

      const model = channel.model || 'gpt-4o-mini';

      if (channel.serviceType === 'anthropic') {
        const client = new Anthropic({ apiKey: key, baseURL: channel.baseUrl || undefined });
        await client.messages.create({
          model: model.includes('claude') ? model : 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        });
      } else {
        const openai = new OpenAI({ apiKey: key, baseURL: channel.baseUrl || undefined });
        await openai.models.list();
      }

      res.json({ success: true, message: `Channel "${channel.name || 'ad-hoc'}" connected successfully` });
    } catch (err) {
      log.warn('Channel test failed', { error: err.message });
      res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Fetch model list ──────────────────────────────────────────────
  async listModels(req, res) {
    try {
      const channel = channelService.getByName(req.params.name);
      if (!channel) return res.status(404).json({ success: false, error: `Channel "${req.params.name}" not found` });

      const key = channel.apiKeys[0];
      if (!key) return res.status(400).json({ success: false, error: 'No API key for this channel' });

      if (channel.serviceType === 'anthropic') {
        // Anthropic doesn't expose a public model list endpoint; return empty
        return res.json({ success: true, models: [], source: 'empty' });
      }

      const openai = new OpenAI({ apiKey: key, baseURL: channel.baseUrl || undefined });
      const list = await openai.models.list();
      const models = list.data
        .sort((a, b) => b.created - a.created)
        .slice(0, 50)
        .map(m => ({ id: m.id, name: m.id }));

      res.json({ success: true, models, source: 'live' });
    } catch (err) {
      log.warn('Could not fetch models', { error: err.message });
      res.status(503).json({ success: false, error: err.message });
    }
  }
}

export default new ChannelController();
