/**
 * WhisperController — Whisper 模型管理 API
 *
 * 处理 /api/config/whisper-models
 *       /api/config/whisper-download
 */

import whisperService from '../../services/config/whisper.service.js';
import { sendSuccess, sendError } from '../../lib/response.js';

class WhisperController {
  async listModels(req, res) {
    try {
      const models = await whisperService.listModels();
      return sendSuccess(res, { models });
    } catch (err) {
      return sendError(res, err);
    }
  }

  async downloadModel(req, res) {
    try {
      const { model } = req.body || {};
      const result = await whisperService.downloadModel(model);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }
}

export default new WhisperController();
