/**
 * Channel Service — multi-provider AI channel management.
 *
 * Responsibilities:
 *   - Persistence: read/write config/channels.json
 *   - Auto-migration: creates channels.json from legacy .env on first run
 *   - Scheduling: priority-sorted + round-robin within same priority
 *   - Circuit breaker: auto-pause after N consecutive failures
 *   - CRUD: add, update, delete channels
 *   - Hot reload: fs.watch on channels.json
 *
 * Channel schema:
 *   {
 *     name:        string,       // display name, unique identifier
 *     serviceType: 'openai-compatible' | 'anthropic',
 *     baseUrl?:    string,       // empty = SDK default endpoint
 *     apiKeys:     string[],     // one or more keys (round-robin per-key is future)
 *     model:       string,       // e.g. "gpt-4o-mini"
 *     priority:    number,       // lower = higher priority, default 10
 *     status:      'active' | 'paused' | 'disabled',  // default 'active'
 *   }
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

const log = logger('ChannelService');

const CHANNELS_PATH = path.join(process.cwd(), 'config', 'channels.json');
const ENV_PATH = path.join(process.cwd(), '.env');

const DEFAULT_PRIORITY = 10;
const MAX_CONSECUTIVE_FAILURES = 3;

class ChannelService {
  constructor() {
    /** @type {Array} in-memory channel list */
    this.channels = [];
    /** @type {Object<string, number>} channelName -> consecutive failures */
    this._failureCounts = {};
    /** @type {Object<number, number>} priority -> round-robin index */
    this._rrIndex = {};
    /** @type {fs.FSWatcher|null} */
    this._watcher = null;

    this._ensureConfigDir();
    this.loadChannels();
  }

  // ── Initialisation ────────────────────────────────────────────────────

  _ensureConfigDir() {
    const dir = path.dirname(CHANNELS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _shouldMigrateFromEnv() {
    if (fs.existsSync(CHANNELS_PATH)) return false;
    // Check if any legacy env vars exist
    dotenv.config({ path: ENV_PATH, override: true });
    return !!(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
  }

  _migrateFromEnv() {
    log.info('No channels.json found — migrating from legacy .env configuration');
    dotenv.config({ path: ENV_PATH, override: true });
    const channels = [];

    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (openaiKey) {
      channels.push({
        name: 'OpenAI',
        serviceType: 'openai-compatible',
        baseUrl: '',
        apiKeys: [openaiKey],
        model: process.env.MODEL_OPENAI || 'gpt-4o-mini',
        priority: 1,
        status: 'active',
      });
    }

    if (process.env.GROQ_API_KEY) {
      channels.push({
        name: 'Groq',
        serviceType: 'openai-compatible',
        baseUrl: '',
        apiKeys: [process.env.GROQ_API_KEY],
        model: process.env.MODEL_GROK || 'llama-3.3-70b-versatile',
        priority: 2,
        status: 'active',
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (geminiKey) {
      // Gemini uses a compatibility layer — still openai-compatible at the channel level
      // but the actual SDK is different. For now, map to openai-compatible so a future
      // channel with gemini baseUrl can be used. If the user had Gemini keys before,
      // they'd need a custom channel to use them — the old SDK path is removed.
      // Skip Gemini migration since we no longer ship that SDK.
      log.info('Gemini key found in .env — skipped automatic migration (Gemini support removed, use an OpenAI-compatible proxy instead)');
    }

    if (process.env.ANTHROPIC_API_KEY) {
      channels.push({
        name: 'Anthropic',
        serviceType: 'anthropic',
        baseUrl: '',
        apiKeys: [process.env.ANTHROPIC_API_KEY],
        model: process.env.MODEL_CLAUDE || 'claude-sonnet-4-5',
        priority: 3,
        status: 'active',
      });
    }

    if (channels.length === 0) {
      // No keys at all — create a placeholder so the file exists
      channels.push({
        name: 'My Channel',
        serviceType: 'openai-compatible',
        baseUrl: '',
        apiKeys: [],
        model: 'gpt-4o-mini',
        priority: DEFAULT_PRIORITY,
        status: 'active',
      });
    }

    this.channels = channels;
    this._save();
    log.info(`Migrated ${channels.length} channel(s) from .env to ${CHANNELS_PATH}`);
  }

  // ── Load / Save ───────────────────────────────────────────────────────

  loadChannels() {
    if (this._shouldMigrateFromEnv()) {
      this._migrateFromEnv();
      return;
    }

    try {
      if (!fs.existsSync(CHANNELS_PATH)) {
        this.channels = [];
        this._save();
        log.info('Created empty channels.json');
        return;
      }
      const raw = fs.readFileSync(CHANNELS_PATH, 'utf8');
      this.channels = JSON.parse(raw);
      // Normalise: ensure every channel has required fields
      this.channels = this.channels.map(ch => ({
        ...ch,
        serviceType: ch.serviceType || 'openai-compatible',
        status: ch.status || 'active',
        priority: ch.priority ?? DEFAULT_PRIORITY,
        apiKeys: ch.apiKeys || [],
      }));
      log.info(`Loaded ${this.channels.length} channel(s) from channels.json`);
    } catch (err) {
      log.error('Failed to load channels.json', { error: err.message });
      this.channels = [];
    }
  }

  _save() {
    try {
      this._ensureConfigDir();
      fs.writeFileSync(CHANNELS_PATH, JSON.stringify(this.channels, null, 2), 'utf8');
    } catch (err) {
      log.error('Failed to save channels.json', { error: err.message });
    }
  }

  // ── Hot reload ────────────────────────────────────────────────────────

  watchChannels() {
    if (this._watcher) return;
    try {
      if (!fs.existsSync(CHANNELS_PATH)) return;
      this._watcher = fs.watch(CHANNELS_PATH, () => {
        this.loadChannels();
        log.info('Reloaded channels.json due to file change');
      });
    } catch (err) {
      log.warn('Could not watch channels.json', { error: err.message });
    }
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────

  getAll() {
    return [...this.channels];
  }

  getByName(name) {
    return this.channels.find(ch => ch.name === name) || null;
  }

  /**
   * Return active channels sorted by priority (ascending).
   * Channels with the same priority maintain their array order.
   */
  getActiveChannels() {
    return this.channels
      .filter(ch => ch.status === 'active')
      .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY));
  }

  /**
   * Get the next channel to use, implementing round-robin within each
   * priority level. Returns { channel, remainingAttempts } or null if
   * no active channels exist.
   */
  getNextChannel() {
    const active = this.getActiveChannels();
    if (active.length === 0) return null;

    // Group by priority
    const groups = {};
    for (const ch of active) {
      const p = ch.priority ?? DEFAULT_PRIORITY;
      if (!groups[p]) groups[p] = [];
      groups[p].push(ch);
    }

    const priorities = Object.keys(groups).map(Number).sort((a, b) => a - b);

    // Try each priority level in order
    for (const p of priorities) {
      const pool = groups[p];
      if (pool.length === 0) continue;

      // Filter out failed channels if they haven't cooled down
      const available = pool.filter(ch => {
        const fails = this._failureCounts[ch.name] || 0;
        return fails < MAX_CONSECUTIVE_FAILURES;
      });
      if (available.length === 0) continue;

      // Round-robin within this priority level
      if (!(p in this._rrIndex)) this._rrIndex[p] = 0;
      const idx = this._rrIndex[p] % available.length;
      this._rrIndex[p] = (this._rrIndex[p] + 1) % available.length;

      return { channel: available[idx], remainingAttempts: available.length };
    }

    return null;
  }

  // ── Circuit breaker ───────────────────────────────────────────────────

  recordFailure(channelName) {
    const current = (this._failureCounts[channelName] || 0) + 1;
    this._failureCounts[channelName] = current;
    log.warn(`Channel "${channelName}" failure ${current}/${MAX_CONSECUTIVE_FAILURES}`);

    if (current >= MAX_CONSECUTIVE_FAILURES) {
      // Auto-pause
      const ch = this.getByName(channelName);
      if (ch && ch.status === 'active') {
        ch.status = 'paused';
        ch.pausedReason = 'circuit_breaker';
        this._save();
        log.warn(`Channel "${channelName}" auto-paused after ${current} consecutive failures`);
      }
      delete this._failureCounts[channelName];
    }
  }

  recordSuccess(channelName) {
    if (this._failureCounts[channelName]) {
      delete this._failureCounts[channelName];
      log.debug(`Channel "${channelName}" failure count reset`);
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  addChannel(channel) {
    if (!channel.name) throw new Error('Channel name is required');
    if (this.getByName(channel.name)) throw new Error(`Channel "${channel.name}" already exists`);
    if (!['openai-compatible', 'anthropic'].includes(channel.serviceType)) {
      throw new Error(`Invalid serviceType "${channel.serviceType}". Must be "openai-compatible" or "anthropic"`);
    }

    const entry = {
      name: channel.name.trim(),
      serviceType: channel.serviceType,
      baseUrl: channel.baseUrl || '',
      apiKeys: (channel.apiKeys || []).filter(k => k.trim()),
      model: channel.model || '',
      priority: channel.priority ?? DEFAULT_PRIORITY,
      status: channel.status || 'active',
    };
    this.channels.push(entry);
    this._save();
    log.info(`Added channel "${entry.name}"`);
    return entry;
  }

  updateChannel(name, updates) {
    const idx = this.channels.findIndex(ch => ch.name === name);
    if (idx === -1) throw new Error(`Channel "${name}" not found`);

    const allowed = ['name', 'serviceType', 'baseUrl', 'apiKeys', 'model', 'priority', 'status'];
    for (const key of Object.keys(updates)) {
      if (!allowed.includes(key)) continue;
      if (key === 'serviceType' && !['openai-compatible', 'anthropic'].includes(updates[key])) {
        throw new Error(`Invalid serviceType "${updates[key]}"`);
      }
      this.channels[idx][key] = updates[key];
    }

    // If renaming, clear old failure count
    if (updates.name && updates.name !== name) {
      delete this._failureCounts[name];
      delete this._failureCounts[updates.name];
    }

    this._save();
    log.info(`Updated channel "${name}"`);
    return this.channels[idx];
  }

  deleteChannel(name) {
    const idx = this.channels.findIndex(ch => ch.name === name);
    if (idx === -1) throw new Error(`Channel "${name}" not found`);
    this.channels.splice(idx, 1);
    delete this._failureCounts[name];
    this._save();
    log.info(`Deleted channel "${name}"`);
  }

  setStatus(name, status) {
    if (!['active', 'paused', 'disabled'].includes(status)) {
      throw new Error(`Invalid status "${status}"`);
    }
    const ch = this.getByName(name);
    if (!ch) throw new Error(`Channel "${name}" not found`);
    ch.status = status;
    if (status === 'active') {
      delete this._failureCounts[name];
    }
    this._save();
    log.info(`Channel "${name}" status → ${status}`);
    return ch;
  }

  // ── Reorder ───────────────────────────────────────────────────────────

  reorder(names) {
    const orderMap = {};
    names.forEach((name, idx) => { orderMap[name] = idx; });
    const reordered = [];
    const notFound = [];
    for (const name of names) {
      const ch = this.getByName(name);
      if (ch) reordered.push(ch);
      else notFound.push(name);
    }
    // Append channels not in the order list
    for (const ch of this.channels) {
      if (!orderMap.hasOwnProperty(ch.name)) {
        reordered.push(ch);
      }
    }
    this.channels = reordered;
    if (notFound.length) {
      log.warn('reorder: some names not found', { notFound });
    }
    this._save();
  }
}

export default new ChannelService();
