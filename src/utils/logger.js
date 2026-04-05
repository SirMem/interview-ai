/**
 * Production-level logger utility
 * Provides structured logging with appropriate log levels.
 * Every log call also writes to logs/app.json via file-logger.
 */
import { logEvent } from './file-logger.js';

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const CURRENT_LOG_LEVEL =
  LOG_LEVELS[LOG_LEVEL.toUpperCase()] ?? LOG_LEVELS.INFO;

class Logger {
  constructor(module) {
    this.module = module || 'App';
  }

  _shouldLog(level) {
    return LOG_LEVELS[level] <= CURRENT_LOG_LEVEL;
  }

  _formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.module}]`;

    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
  }

  _writeToJson(level, message, data = null) {
    const fields = { module: this.module };
    if (data) fields.data = data;
    logEvent(message, level, fields);
  }

  error(message, error = null) {
    if (this._shouldLog('ERROR')) {
      if (error) {
        console.error(this._formatMessage('ERROR', message), error);
        this._writeToJson('ERROR', message, { error: error.message || String(error), stack: error.stack });
      } else {
        console.error(this._formatMessage('ERROR', message));
        this._writeToJson('ERROR', message);
      }
    }
  }

  warn(message, data = null) {
    if (this._shouldLog('WARN')) {
      console.warn(this._formatMessage('WARN', message, data));
      this._writeToJson('WARN', message, data);
    }
  }

  info(message, data = null) {
    if (this._shouldLog('INFO')) {
      console.log(this._formatMessage('INFO', message, data));
      this._writeToJson('INFO', message, data);
    }
  }

  debug(message, data = null) {
    if (this._shouldLog('DEBUG')) {
      console.log(this._formatMessage('DEBUG', message, data));
      this._writeToJson('DEBUG', message, data);
    }
  }
}

export default (module) => new Logger(module);
