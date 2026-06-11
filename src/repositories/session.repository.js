/**
 * SessionRepository — 数据访问层
 *
 * 封装所有 session 相关的 SQLite 操作，与业务逻辑分离。
 * Service 层通过依赖注入使用此 Repository。
 *
 * @example
 *   const repo = new SessionRepository(db)
 *   const session = repo.findById(id)
 */

export class SessionRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
  }

  // ── Sessions ────────────────────────────────────────────

  /** @param {string} id */
  findById(id) {
    // TODO: 移植自 session.service.js
    throw new Error('Not implemented');
  }

  /**
   * @param {{ limit?: number, offset?: number }} options
   * @returns {{ sessions: Array, pagination: object }}
   */
  list(options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * @param {object} data
   * @returns {object}
   */
  create(data) {
    throw new Error('Not implemented');
  }

  // ── Conversation Turns ──────────────────────────────────

  /**
   * @param {string} sessionId
   * @returns {Array}
   */
  getTurns(sessionId) {
    throw new Error('Not implemented');
  }

  /**
   * @param {object} turnData
   * @returns {object}
   */
  insertTurn(turnData) {
    throw new Error('Not implemented');
  }

  // ── FTS5 Search ─────────────────────────────────────────

  /**
   * @param {string} query
   * @param {{ limit?: number, offset?: number }} options
   * @returns {{ turns: Array, pagination: object }}
   */
  searchTurns(query, options = {}) {
    throw new Error('Not implemented');
  }

  // ── Events ──────────────────────────────────────────────

  /**
   * @param {string} sessionId
   * @param {string} eventType
   * @param {object} payload
   * @returns {object}
   */
  appendEvent(sessionId, eventType, payload = {}) {
    throw new Error('Not implemented');
  }

  /**
   * @param {string} sessionId
   * @param {string} status
   * @param {string} endedAt
   */
  updateStatus(sessionId, status, endedAt) {
    throw new Error('Not implemented');
  }

  /** 归档超过 12 小时未更新的活跃 session */
  archiveStale() {
    throw new Error('Not implemented');
  }
}
