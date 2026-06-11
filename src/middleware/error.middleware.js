/**
 * 统一错误处理中间件
 *
 * 处理以下错误类型：
 *   1. http-errors（有 statusCode 字段）
 *   2. ZodError（参数校验失败 → 400）
 *   3. MulterError（文件上传失败 → 400）
 *   4. 普通 Error（→ 500）
 *
 * 所有响应格式统一为：
 *   { success: false, error: '...', code: '...', details?: [...] }
 */

import multer from 'multer';
import logger from '../utils/logger.js';

const log = logger('ErrorMiddleware');

export const errorHandler = (err, req, res, next) => {
  // ── http-errors（含我们的 AppError 工厂函数抛出的） ────
  if (err.statusCode) {
    const body = {
      success: false,
      error: err.message,
      code: err.code || 'ERROR',
    };
    if (err.details) body.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  // ── Zod 校验错误 ────────────────────────────────────
  if (err.name === 'ZodError') {
    const details = err.issues?.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details,
    });
  }

  // ── Multer 文件上传错误 ─────────────────────────────
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.',
        code: 'FILE_TOO_LARGE',
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'UPLOAD_ERROR',
    });
  }

  // ── 未知错误（兜底） ────────────────────────────────
  log.error('Unhandled error', err);
  const body = {
    success: false,
    error: err.message || 'Internal server error',
    code: 'INTERNAL_ERROR',
  };
  // 开发环境暴露堆栈
  if (process.env.NODE_ENV === 'development' && err.stack) {
    body.stack = err.stack;
  }
  return res.status(500).json(body);
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
};
