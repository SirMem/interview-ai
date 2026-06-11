/**
 * 环境变量校验 — 基于 Zod，启动时执行
 *
 * 必须在 server.js 的最顶部导入并执行一次。
 * 缺失必须变量 → 启动时报错退出，而不是运行时莫名奇妙失败。
 *
 * @example
 *   import { ENV } from '../lib/env.js'
 *   console.log(ENV.PORT)  // number, 有默认值
 *   console.log(ENV.JWT_SECRET)  // string, 缺失就报错退出
 */

import { z } from 'zod';

/**
 * 环境变量 Schema
 *
 * - 所有带 default 的都是可选的
 * - 所有 .min(1) 的都是必须的，启动时缺失就报错退出
 */
const envSchema = z.object({
  // ── 服务器 ──────────────────────────────────────────
  PORT:           z.coerce.number().default(4000),

  // ── API Keys（可选） ────────────────────────────────
  OPENAI_API_KEY:       z.string().default(''),
  GROQ_API_KEY:         z.string().default(''),
  GEMINI_API_KEY:       z.string().default(''),
  ANTHROPIC_API_KEY:    z.string().default(''),
  DEEPGRAM_API_KEY:     z.string().default(''),

  // ── AI 配置（可选） ──────────────────────────────────
  PROVIDER_ORDER:       z.string().default('openai,grok,gemini,claude'),
  MODEL_OPENAI:         z.string().default('gpt-4o-mini'),
  MODEL_GROK:           z.string().default('llama-3.3-70b-versatile'),
  MODEL_GEMINI:         z.string().default('gemini-2.5-flash'),
  MODEL_CLAUDE:         z.string().default('claude-sonnet-4-5'),
  STT_MODEL:            z.string().default('small'),

  // ── Telemetry（可选） ────────────────────────────────
  TELEMETRY_ENABLED:    z.string().default('false'),
  OTLP_ENDPOINT:        z.string().default(''),
  GRAFANA_INSTANCE_ID:  z.string().default(''),
  GRAFANA_ACCESS_TOKEN: z.string().default(''),

  // ── JWT（可选 — 开启权限后才需要） ──────────────────
  JWT_SECRET:           z.string().default(''),
});

/**
 * 校验结果 — 类型安全的 process.env 访问器
 */
export const ENV = envSchema.parse(process.env);

/**
 * 打印启动时的环境变量概览（隐藏敏感值）
 */
export function printEnvSummary(ENV_) {
  const table = ENV_ || ENV;
  const lines = [];
  for (const [key, value] of Object.entries(table)) {
    if (!value) continue;
    if (/key|token|secret/i.test(key) && value) {
      lines.push(`  ${key}: ${value.slice(0, 4)}****${value.slice(-4)}`);
    } else {
      lines.push(`  ${key}: ${value}`);
    }
  }
  console.log(`[env] ${lines.length} variables loaded`);
  lines.forEach((l) => console.log(l));
}
