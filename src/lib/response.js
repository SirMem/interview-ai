/**
 * 统一响应格式工具
 *
 * 所有 controller 的响应必须通过此模块返回，保证格式一致性：
 *   { success: true, ...data }
 *   { success: false, error: '...', details?: ... }
 *
 * @example
 *   import { sendSuccess, sendError } from '../lib/response.js'
 *   sendSuccess(res, { session })
 *   sendError(res, error)  // 自动读取 error.statusCode
 */

/**
 * 成功响应
 * @param {import('express').Response} res
 * @param {object} data - 响应体数据（不含 success 字段）
 * @param {{ status?: number, meta?: object }} [options]
 */
export function sendSuccess(res, data = {}, { status = 200, meta } = {}) {
  const body = { success: true, ...data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * 错误响应
 * @param {import('express').Response} res
 * @param {Error|import('./errors.js').AppError} error
 */
export function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const body = {
    success: false,
    error: error.message || 'Internal server error',
  };
  if (error.details) body.details = error.details;
  if (error.code)    body.code = error.code;

  // 仅在开发环境暴露堆栈
  if (process.env.NODE_ENV === 'development' && error.stack) {
    body.stack = error.stack;
  }

  return res.status(statusCode).json(body);
}
