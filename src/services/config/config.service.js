/**
 * ConfigService — 配置管理
 *
 * 封装 .env 文件的读写、配置缓存等。
 * 从原来 config.controller.js 中提取而来的纯服务层。
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from '../../utils/logger.js';

const log = logger('ConfigService');
const ENV_FILE_PATH = path.join(process.cwd(), '.env');

// ── Provider 常量 ────────────────────────────────────────

export const KNOWN_PROVIDER_LABELS = {
  openai: 'OpenAI',
  grok: 'Grok (Groq)',
  gemini: 'Gemini',
  claude: 'Claude (Anthropic)',
};

export const FALLBACK_MODELS = {
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ],
  grok: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  ],
  claude: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  ],
};

export const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  grok: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  claude: 'claude-sonnet-4-5',
};

class ConfigService {
  /**
   * 读取全部配置
   * @returns {object}
   */
  readFull() {
    // TODO: 移植自 ConfigController._readConfig()
    throw new Error('Not implemented — will migrate from ConfigController');
  }

  /**
   * 保存部分配置到 .env
   * @param {Record<string, string>} updates
   */
  applyUpdates(updates) {
    // TODO: 移植自 ConfigController._writeDotEnvKeys()
    throw new Error('Not implemented');
  }

  /**
   * 获取某个 provider 的 API key
   * @param {string} providerId
   * @returns {string}
   */
  getApiKey(providerId) {
    const envKey = {
      openai: 'OPENAI_API_KEY',
      grok: 'GROQ_API_KEY',
      gemini: 'GEMINI_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
    }[providerId];
    if (!envKey) return '';
    return process.env[envKey] || '';
  }
}

export default new ConfigService();
