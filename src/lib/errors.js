/**
 * AppError — 统一错误类体系
 *
 * 所有控制器/服务层抛出的业务错误统一使用此层级。
 * error.middleware.js 根据 instanceof 判断返回格式。
 *
 * @example
 *   throw new NotFoundError(`Session "${id}" not found`)
 *   throw new ValidationError('name is required')
 *   throw new AuthError('Invalid token')
 */

export class AppError extends Error {
  /**
   * @param {number} statusCode - HTTP 状态码
   * @param {string} message    - 错误描述
   * @param {{ code?: string, details?: unknown }} [options]
   */
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || 'ERROR';
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', options) {
    super(404, message, { code: 'NOT_FOUND', ...options });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', options) {
    super(400, message, { code: 'VALIDATION_ERROR', ...options });
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized', options) {
    super(401, message, { code: 'AUTH_ERROR', ...options });
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', options) {
    super(403, message, { code: 'FORBIDDEN', ...options });
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', options) {
    super(409, message, { code: 'CONFLICT', ...options });
    this.name = 'ConflictError';
  }
}
