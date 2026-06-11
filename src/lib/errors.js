/**
 * 统一错误类体系
 *
 * 基于 http-errors 实现，一行创建带状态码的错误。
 * 所有 controller/service 层抛出的业务错误统一使用此模块。
 *
 * @example
 *   import { notFound, badRequest, unauthorized } from '../lib/errors.js'
 *   throw notFound(`Session "${id}" not found`)
 *   throw badRequest('name is required')
 */

import createError from 'http-errors';

// ── 常见 HTTP 错误 —— 一行工厂函数 ──────────────────────

/** 400 Bad Request */
export const badRequest = (message = 'Bad request', properties) => {
  const err = createError(400, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 401 Unauthorized */
export const unauthorized = (message = 'Unauthorized', properties) => {
  const err = createError(401, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 403 Forbidden */
export const forbidden = (message = 'Forbidden', properties) => {
  const err = createError(403, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 404 Not Found */
export const notFound = (message = 'Resource not found', properties) => {
  const err = createError(404, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 409 Conflict */
export const conflict = (message = 'Resource already exists', properties) => {
  const err = createError(409, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 422 Unprocessable Entity */
export const unprocessable = (message = 'Unprocessable entity', properties) => {
  const err = createError(422, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 429 Too Many Requests */
export const tooManyRequests = (message = 'Rate limit exceeded', properties) => {
  const err = createError(429, message);
  if (properties) Object.assign(err, properties);
  return err;
};

/** 500 Internal Server Error */
export const internal = (message = 'Internal server error', properties) => {
  const err = createError(500, message);
  if (properties) Object.assign(err, properties);
  return err;
};

// ── 全通用接口 —— 任意状态码 ───────────────────────────

/**
 * 创建任意 HTTP 错误
 * @param {number} status - HTTP 状态码
 * @param {string} message - 错误描述
 * @param {{ details?: unknown }} [options]
 */
export const httpError = (status, message, { details } = {}) => {
  const err = createError(status, message);
  if (details) err.details = details;
  return err;
};

// ── 判断函数 ──────────────────────────────────────────

/**
 * 判断一个错误是否来自本模块（http-errors 实例或原生 Error）
 * @param {unknown} err
 * @returns {err is import('http-errors').HttpError}
 */
export const isHttpError = (err) => err?.statusCode != null;
