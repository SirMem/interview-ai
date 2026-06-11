/**
 * 结构化日志 — 基于 pino
 *
 * 对外接口与旧版 logger.js 完全一致，内部替换为 pino。
 * 所有使用 `logger('ModuleName').info(...)` 的代码无需改动。
 *
 * pino 优势：
 *   - 最快 Node.js 日志库（比 console.log 快 5×）
 *   - 自动 JSON 序列化
 *   - 错误对象自动展开（不再需要手动 .message + .stack）
 *   - 生产环境可直接输出 JSON 供日志系统采集
 */

import pino from 'pino';
import { logEvent } from './telemetry.js';

// ── 全局 pino 实例（不含 module name，由子 logger 添加） ──
const LEVEL = process.env.LOG_LEVEL || 'INFO';

// 映射我们的日志级别到 pino 级别
const LEVEL_MAP = { ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' };
const PINO_LEVEL = LEVEL_MAP[LEVEL] || 'info';

const baseLogger = pino({
  level: PINO_LEVEL,
  // 开发环境输出可读格式，生产环境输出 JSON
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino/file',  // 无 pino-pretty 时用标准输出
        options: { colorize: false },
      },
  // 禁用 pino 默认的时间戳格式，我们自己加
  timestamp: pino.stdTimeFunctions.isoTime,
});

class Logger {
  constructor(module) {
    this.module = module || 'App';
    // 创建带 module 名称的子 logger
    this._logger = baseLogger.child({ module: this.module });
  }

  error(message, error = null) {
    if (error) {
      this._logger.error({ err: error }, message);
      this._writeToJson('ERROR', message, {
        error: error.message || String(error),
        stack: error.stack,
      });
    } else {
      this._logger.error(message);
      this._writeToJson('ERROR', message);
    }
  }

  warn(message, data = null) {
    this._logger.warn(data || {}, message);
    this._writeToJson('WARN', message, data);
  }

  info(message, data = null) {
    this._logger.info(data || {}, message);
    this._writeToJson('INFO', message, data);
  }

  debug(message, data = null) {
    this._logger.debug(data || {}, message);
    this._writeToJson('DEBUG', message, data);
  }

  /** 保持 telemetry 集成（写入 OTel / fallback JSONL） */
  _writeToJson(level, message, data = null) {
    const fields = { module: this.module };
    if (data) fields.data = data;
    logEvent(message, level, fields);
  }
}

export default (module) => new Logger(module);
