/**
 * HTTP 请求审计 + 性能采集中间件
 *
 * 两个职责：
 *   1. 审计日志 — 每条请求记录 method / path / query / body（脱敏）
 *   2. 性能指标 — http_request_duration_ms 直方图
 *
 * 挂载在 app.js 最前面，保证覆盖所有路由（含 404）。
 */

import { recordHistogram } from '../utils/telemetry.js';
import { logEvent } from '../utils/telemetry.js';

// 敏感字段 — 在审计日志中隐藏真实值
const SENSITIVE_FIELDS = new Set([
  'password', 'secret', 'token', 'api_key', 'apiKey',
  'access_token', 'accessToken', 'authorization',
  'key', 'keys',
]);

/**
 * 脱敏对象中的敏感字段
 * @param {object} obj
 * @returns {object}
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = value ? '***' : '';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitize(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) => (typeof v === 'object' ? sanitize(v) : v));
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function httpTelemetryMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  // ── 审计日志：请求到达时记录 ──────────────────────────
  const audit = {
    method: req.method,
    path: req.originalUrl || req.url,
    query: Object.keys(req.query || {}).length > 0 ? req.query : undefined,
    body: ['POST', 'PUT', 'PATCH'].includes(req.method)
      ? sanitize(req.body || {})
      : undefined,
  };

  logEvent('http_request_received', 'INFO', audit);

  // ── 响应结束时记录耗时 + 状态码 ──────────────────────
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    const route = req.route?.path
      ?? req.baseUrl + (req.route?.path ?? req.path)
      ?? req.path;

    recordHistogram('http_request_duration_ms', durationMs, {
      method: req.method,
      route: _normalizeRoute(route || req.path),
      status_code: String(res.statusCode),
    });

    logEvent('http_request_completed', 'INFO', {
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: Math.round(durationMs),
    });
  });

  next();
}

/** 压缩高基数 URL 片段（数字 ID、UUID）为占位符 */
function _normalizeRoute(route) {
  if (!route || typeof route !== 'string') return 'unknown';
  return route
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid');
}
