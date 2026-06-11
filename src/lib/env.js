/**
 * 环境变量校验 —— 启动时校验必须变量
 *
 * 规划：基于 Zod 实现。安装后可按以下模式使用：
 *
 * @example
 *   import { ENV } from '../lib/env.js'
 *   console.log(ENV.PORT)   // number, 有默认值
 *   console.log(ENV.OPENAI_API_KEY)  // string | undefined
 *
 * 当前为占位桩 —— 安装 zod 后即可启用完整功能。
 */

/**
 * 校验并返回类型安全的环境变量
 * @returns {Record<string, unknown>}
 */
export function loadEnv() {
  // TODO: 安装 zod 后替换为 schema.parse(process.env)
  return process.env;
}

/**
 * 打印启动时的环境变量概览（隐藏敏感值）
 */
export function printEnvSummary() {
  const keys = Object.keys(process.env).filter(
    (k) => !k.startsWith('npm_') && !k.startsWith('_'),
  );
  const masked = keys.map((k) => {
    const v = process.env[k];
    if (!v) return `  ${k}: (empty)`;
    if (/key|token|secret|password/i.test(k)) {
      return `  ${k}: ${v.slice(0, 4)}****${v.slice(-4)}`;
    }
    return `  ${k}: ${v}`;
  });
  console.log(`[env] ${keys.length} variables loaded`);
  if (process.env.NODE_ENV === 'development') {
    masked.forEach((l) => console.log(l));
  }
}
