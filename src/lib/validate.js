/**
 * 参数校验工具 — 声明式 schema 校验
 *
 * 规划：基于 Zod 实现。安装后可按以下模式使用：
 *
 * @example
 *   import { z } from 'zod'
 *   import { validate } from '../lib/validate.js'
 *
 *   const createSessionSchema = z.object({
 *     type: z.enum(['live', 'mock', 'practice']).optional(),
 *     title: z.string().max(200).optional(),
 *   })
 *
 *   // 在 controller 中:
 *   const data = validate(createSessionSchema, req.body)
 *
 * 当前为占位桩 —— 安装 zod 后即可启用完整功能。
 */

/**
 * 校验数据并返回类型安全的结果
 * @param {import('zod').ZodSchema} schema
 * @param {unknown} data
 * @returns {unknown}
 * @throws {import('./errors.js').ValidationError}
 */
export function validate(schema, data) {
  if (!schema || typeof schema.parse !== 'function') {
    throw new Error('validate() requires a Zod schema — install zod first');
  }
  try {
    return schema.parse(data);
  } catch (err) {
    const { ValidationError } = require('./errors.js');
    throw new ValidationError('Validation failed', {
      details: err.errors || err.issues,
    });
  }
}
