/**
 * WhisperService — Whisper 模型管理
 *
 * 与 Python 后端通信，查询/下载本地 Whisper STT 模型。
 */

import logger from '../../utils/logger.js';

const log = logger('WhisperService');
const TRANSCRIBER_BASE = 'http://localhost:8000';

const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large'];
const MODEL_SIZE_LABELS = {
  tiny: '~75 MB',
  base: '~145 MB',
  small: '~465 MB',
  medium: '~1.5 GB',
  large: '~2.9 GB',
};

class WhisperService {
  /** @returns {string[]} 可用模型列表 */
  getAvailableModels() {
    return WHISPER_MODELS;
  }

  /**
   * 获取模型列表（含下载状态）
   * @returns {Promise<Array<{ name: string, downloaded: boolean|null, sizeLabel: string }>>}
   */
  async listModels() {
    // TODO: 移植自 ConfigController.getWhisperModels()
    throw new Error('Not implemented');
  }

  /**
   * 触发模型下载
   * @param {'tiny'|'base'|'small'|'medium'|'large'} model
   * @returns {Promise<object>}
   */
  async downloadModel(model) {
    // TODO: 移植自 ConfigController.downloadWhisperModel()
    throw new Error('Not implemented');
  }
}

export default new WhisperService();
