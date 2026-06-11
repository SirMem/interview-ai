/**
 * DeepgramService — Deepgram STT 代理
 *
 * 处理深格语音转写相关的 HTTP 代理调用（向 Python 后端的转发）。
 */

import logger from '../../utils/logger.js';

const log = logger('DeepgramService');

const TRANSCRIBER_BASE = 'http://localhost:8000';

class DeepgramService {
  /**
   * 测试 Deepgram API key 有效性
   * @param {string} apiKey
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async testKey(apiKey) {
    // TODO: 移植自 ConfigController.testDeepgramKey()
    throw new Error('Not implemented');
  }

  /**
   * 启动语音注册流程
   * @param {number} duration 秒
   * @returns {Promise<object>}
   */
  async enrollVoice(duration) {
    throw new Error('Not implemented');
  }

  /** 查询注册状态 */
  async enrollmentStatus() {
    throw new Error('Not implemented');
  }

  /** 清除注册 */
  async clearEnrollment() {
    throw new Error('Not implemented');
  }
}

export default new DeepgramService();
