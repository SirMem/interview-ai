/**
 * 权限中间件 — 基于 JWT 的可选认证
 *
 * 两种模式：
 *   1. JWT_SECRET 未设置 → 认证关闭，所有请求放行（开发/本地）
 *   2. JWT_SECRET 已设置 → 带 requireAuth 的路由需 Bearer token
 *
 * @example
 *   import { requireAuth } from '../middleware/auth.middleware.js'
 *
 *   // 公开路由（无需认证）
 *   router.get('/settings', controller.get)
 *
 *   // 受保护路由
 *   router.post('/sessions', requireAuth, controller.create)
 *   router.delete('/channels/:name', requireAuth, controller.delete)
 */

import { expressjwt } from 'express-jwt';
import { ENV } from '../lib/env.js';

const SECRET = ENV.JWT_SECRET;

// ── JWT 校验中间件 ──────────────────────────────────────
// 当 JWT_SECRET 未设置时，直接跳过（跳过 = 放行所有请求）
const jwtMiddleware = SECRET
  ? expressjwt({
      secret: SECRET,
      algorithms: ['HS256'],
      credentialsRequired: false, // 不强制校验，让 requireAuth 决定
    })
  : (req, res, next) => next(); // 无密钥 → 透传

/**
 * 路由级守卫 — 要求请求必须携带有效 JWT
 *
 * 用法：router.delete('/xxx', requireAuth, controller.delete)
 *
 * JWT_SECRET 未设置时自动放行（开发模式）
 */
export function requireAuth(req, res, next) {
  // JWT_SECRET 未设置 → 放行（本地开发）
  if (!SECRET) return next();

  // express-jwt 已经校验过 token，结果在 req.auth 中
  if (!req.auth) {
    return res.status(401).json({
      success: false,
      error: 'Missing or invalid authorization token',
      code: 'AUTH_ERROR',
    });
  }

  // 把 auth 信息挂到 req.user 方便 controller 使用
  req.user = req.auth;
  next();
}

/**
 * 初始化 — 在 app.js 中挂载到所有 /api 路由
 * @param {import('express').Application} app
 */
export function setupAuth(app) {
  if (!SECRET) {
    console.log('[auth] JWT_SECRET not set — authentication disabled');
  } else {
    console.log('[auth] JWT_SECRET configured — protected routes require Bearer token');
  }

  // 挂载 JWT 解析中间件（在所有路由之前）
  app.use('/api', jwtMiddleware);
}

export { SECRET };
