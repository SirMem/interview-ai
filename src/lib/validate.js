/**
 * 参数校验工具 — 基于 Zod 的声明式 Schema 校验
 *
 * 所有 controller 的请求体/查询参数/路径参数都通过此模块校验。
 *
 * @example
 *   import { z } from 'zod'
 *   import { validate } from '../lib/validate.js'
 *
 *   const schema = z.object({
 *     type: z.enum(['live', 'mock', 'practice']).optional(),
 *     title: z.string().max(200).optional(),
 *   })
 *
 *   // 校验通过 → 返回类型安全的数据
 *   // 校验失败 → 抛出 ValidationError（error.middleware 自动处理）
 *   const data = validate(schema, req.body)
 */

import { badRequest } from './errors.js';

/**
 * 校验数据，失败时抛 http-errors 400 badRequest
 *
 * @template T
 * @param {import('zod').ZodSchema<T>} schema - Zod schema
 * @param {unknown} data - 待校验数据（通常是 req.body / req.query）
 * @param {{ message?: string }} [options]
 * @returns {T} 校验通过的类型安全数据
 */
export function validate(schema, data, { message } = {}) {
  const result = schema.safeParse(data);

  if (!result.success) {
    // 提取 Zod 错误信息，拼接成可读的字符串
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    throw badRequest(message || 'Validation failed', { details });
  }

  return result.data;
}
