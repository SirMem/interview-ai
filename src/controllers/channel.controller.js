/**
 * Channel Controller — REST API for channel CRUD and testing.
 *
 * All routes are mounted under /api/channels.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import channelService from '../services/channel.service.js';
import { sendSuccess, sendError } from '../lib/response.js';
import { badRequest, notFound } from '../lib/errors.js';
import logger from '../utils/logger.js';

const log = logger('ChannelController');

class ChannelController {

  // ── List all channels ──────────────────────────────────────────────
  list(req, res, next) {
    try {
      const channels = channelService.getAll();
      return sendSuccess(res, { channels });
    } catch (err) {
      log.error('Error listing channels', { error: err.message });
      return sendError(res, err);
    }
  }

  // ── Get a single channel ──────────────────────────────────────────
  get(req, res, next) {
    try {
      const ch = channelService.getByName(req.params.name);
      if (!ch) throw notFound(`Channel "${req.params.name}" not found`);
      return sendSuccess(res, { channel: ch });
    } catch (err) {
      return sendError(res, err);
    }
  }

  // ── Create a channel ──────────────────────────────────────────────
  create(req, res, next) {
    try {
      const { name, serviceType, baseUrl, apiKeys, model, priority, status } = req.body;
      if (!name) throw badRequest('name is required');
      if (!serviceType) throw badRequest('serviceType is required');

      const channel = channelService.addChannel({
        name, serviceType, baseUrl, apiKeys,
        model: model || '',
        priority: priority ?? undefined,
        status: status || 'active',
      });
      return sendSuccess(res, { channel }, { status: 201 });
    } catch (err) {
      if (err.message.includes('already exists')) {
        return sendError(res, badRequest(err.message));
      }
      return sendError(res, err);
    }
  }

  // ── Update a channel ──────────────────────────────────────────────
  update(req, res, next) {
    try {
      const updates = {};
      for (const key of ['name', 'serviceType', 'baseUrl', 'apiKeys', 'model', 'priority', 'status']) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const channel = channelService.updateChannel(req.params.name, updates);
      return sendSuccess(res, { channel });
    } catch (err) {
      if (err.message.includes('not found')) {
        return sendError(res, notFound(err.message));
      }
      return sendError(res, err);
    }
  }

  // ── Delete a channel ──────────────────────────────────────────────
  delete(req, res, next) {
    try {
      channelService.deleteChannel(req.params.name);
      return sendSuccess(res);
    } catch (err) {
      if (err.message.includes('not found')) {
        return sendError(res, notFound(err.message));
      }
      return sendError(res, err);
    }
  }

  // ── Set channel status (pause / resume) ───────────────────────────
  setStatus(req, res, next) {
    try {
      const { status } = req.body;
      if (!['active', 'paused', 'disabled'].includes(status)) {
        throw badRequest('status must be active, paused, or disabled');
      }
      const channel = channelService.setStatus(req.params.name, status);
      return sendSuccess(res, { channel });
    } catch (err) {
      if (err.message.includes('not found')) {
        return sendError(res, notFound(err.message));
      }
      return sendError(res, err);
    }
  }

  // ── Reorder channels ──────────────────────────────────────────────
  reorder(req, res, next) {
    try {
      const { names } = req.body;
      if (!Array.isArray(names)) {
        throw badRequest('names array is required');
      }
      channelService.reorder(names);
      return sendSuccess(res);
    } catch (err) {
      return sendError(res, err);
    }
  }

  // ── Test channel connectivity ─────────────────────────────────────
  async test(req, res, next) {
    try {
      const { name, apiKey } = req.body;
      let channel;

      if (name) {
        channel = channelService.getByName(name);
        if (!channel) throw notFound(`Channel "${name}" not found`);
      } else {
        const { serviceType, baseUrl } = req.body;
        if (!serviceType) throw badRequest('serviceType or name is required');
        channel = { serviceType, baseUrl, apiKeys: [apiKey || ''], model: req.body.model || '' };
      }

      const key = apiKey || channel.apiKeys[0];
      if (!key) throw badRequest('No API key available for testing');

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

      return sendSuccess(res, { message: `Channel "${channel.name || 'ad-hoc'}" connected successfully` });
    } catch (err) {
      log.warn('Channel test failed', { error: err.message });
      return sendError(res, badRequest(err.message));
    }
  }

  // ── Fetch model list ──────────────────────────────────────────────
  async listModels(req, res, next) {
    try {
      const channel = channelService.getByName(req.params.name);
      if (!channel) throw notFound(`Channel "${req.params.name}" not found`);

      const key = channel.apiKeys[0];
      if (!key) throw badRequest('No API key for this channel');

      if (channel.serviceType === 'anthropic') {
        return sendSuccess(res, { models: [], source: 'empty' });
      }

      const openai = new OpenAI({ apiKey: key, baseURL: channel.baseUrl || undefined });
      const list = await openai.models.list();
      const models = list.data
        .sort((a, b) => b.created - a.created)
        .slice(0, 50)
        .map(m => ({ id: m.id, name: m.id }));

      return sendSuccess(res, { models, source: 'live' });
    } catch (err) {
      log.warn('Could not fetch models', { error: err.message });
      return sendError(res, badRequest(err.message));
    }
  }
}

export default new ChannelController();
