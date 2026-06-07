import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

const log = logger('SessionService');

export const DEFAULT_SESSION_DB_PATH = process.env.SOLVEWATCH_DB_PATH || path.join(process.cwd(), 'data', 'solvewatch.db');

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const VALID_SESSION_TYPES = new Set(['live', 'mock', 'resume_review', 'practice']);
const VALID_SESSION_STATUSES = new Set(['active', 'ended', 'archived']);

export class SessionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionValidationError';
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(raw, fallback = {}) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return isPlainObject(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function toIsoString(date = new Date()) {
  return date.toISOString();
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalMinute(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeOptionalString(value, field, { max = 255, defaultValue = '' } = {}) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'string') throw new SessionValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new SessionValidationError(`${field} must be at most ${max} characters`);
  return trimmed;
}

function normalizePositiveInteger(value, field, { defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new SessionValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return num;
}

export class SessionService {
  constructor({ dbPath = DEFAULT_SESSION_DB_PATH, db = null } = {}) {
    this.dbPath = dbPath;
    this.db = db || this._openDatabase(dbPath);
    this._ownsDb = !db;
    this.activeSessionId = null;
    this._configureDatabase();
    this._initializeSchema();
  }

  _openDatabase(dbPath) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    return new Database(dbPath);
  }

  _configureDatabase() {
    this.db.pragma('foreign_keys = ON');
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    } catch (err) {
      log.warn('Could not apply SQLite WAL pragmas', { error: err.message });
    }
  }

  _initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'live',
        title TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'archived')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

      CREATE TABLE IF NOT EXISTS conversation_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_index INTEGER NOT NULL,
        raw_transcript TEXT NOT NULL DEFAULT '',
        cleaned_question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(session_id, turn_index)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_turns_session ON conversation_turns(session_id, turn_index);
      CREATE INDEX IF NOT EXISTS idx_conversation_turns_created_at ON conversation_turns(created_at DESC);

      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        event_time TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, event_time);
      CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type);

      CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
        turn_id UNINDEXED,
        session_id UNINDEXED,
        cleaned_question,
        answer,
        raw_transcript
      );
    `);
  }

  _mapSession(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      company: row.company,
      role: row.role,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: parseJsonObject(row.metadata_json),
    };
  }

  _validateMetadata(metadata) {
    if (metadata === undefined || metadata === null) return {};
    if (!isPlainObject(metadata)) throw new SessionValidationError('metadata must be an object');
    return metadata;
  }

  _normalizeCreateInput(input = {}) {
    if (!isPlainObject(input)) throw new SessionValidationError('request body must be an object');

    const now = new Date();
    const type = normalizeOptionalString(input.type, 'type', { max: 64, defaultValue: 'live' }) || 'live';
    if (!VALID_SESSION_TYPES.has(type)) {
      throw new SessionValidationError(`type must be one of: ${Array.from(VALID_SESSION_TYPES).join(', ')}`);
    }

    const explicitTitle = normalizeOptionalString(input.title, 'title', { max: 200, defaultValue: '' });
    const title = explicitTitle || `Live Interview - ${formatLocalMinute(now)}`;
    const company = normalizeOptionalString(input.company, 'company', { max: 200, defaultValue: '' });
    const role = normalizeOptionalString(input.role, 'role', { max: 200, defaultValue: '' });
    const metadata = this._validateMetadata(input.metadata);

    return { type, title, company, role, metadata, now };
  }

  createSession(input = {}) {
    const normalized = this._normalizeCreateInput(input);
    const id = randomUUID();
    const timestamp = toIsoString(normalized.now);
    const status = 'active';

    if (!VALID_SESSION_STATUSES.has(status)) {
      throw new Error(`Invalid internal session status: ${status}`);
    }

    this.db.prepare(`
      INSERT INTO sessions (
        id, type, title, company, role, status,
        started_at, ended_at, created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      id,
      normalized.type,
      normalized.title,
      normalized.company,
      normalized.role,
      status,
      timestamp,
      timestamp,
      timestamp,
      JSON.stringify(normalized.metadata),
    );

    this.activeSessionId = id;
    return this.getSession(id);
  }

  listSessions(options = {}) {
    const limit = normalizePositiveInteger(options.limit, 'limit', {
      defaultValue: DEFAULT_LIST_LIMIT,
      min: 1,
      max: MAX_LIST_LIMIT,
    });
    const offset = normalizePositiveInteger(options.offset, 'offset', {
      defaultValue: 0,
      min: 0,
    });

    const total = this.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      ORDER BY updated_at DESC, created_at DESC, rowid DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    return {
      sessions: rows.map(row => this._mapSession(row)),
      pagination: { limit, offset, total },
    };
  }

  getSession(id) {
    const normalizedId = normalizeOptionalString(id, 'id', { max: 128, defaultValue: '' });
    if (!normalizedId) return null;
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(normalizedId);
    return this._mapSession(row);
  }

  close() {
    if (this._ownsDb && this.db?.open) {
      this.db.close();
    }
  }
}

const sessionService = new SessionService();
export default sessionService;
