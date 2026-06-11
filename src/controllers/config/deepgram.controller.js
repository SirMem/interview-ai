/**
 * DeepgramController — Deepgram 配置 API
 *
 * 处理 /api/config/test-deepgram
 *       /api/config/enroll-deepgram-voice
 *       /api/config/deepgram-enrollment-status
 *       /api/config/deepgram-enrollment (DELETE)
 */

import deepgramService from '../../services/config/deepgram.service.js';
import { sendSuccess, sendError } from '../../lib/response.js';

class DeepgramController {
  async testKey(req, res) {
    try {
      const result = await deepgramService.testKey(req.body?.api_key);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }

  async enrollVoice(req, res) {
    try {
      const duration = Math.max(5, Math.min(parseInt(req.body?.duration ?? 12, 10), 30));
      const result = await deepgramService.enrollVoice(duration);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }

  async enrollmentStatus(req, res) {
    try {
      const result = await deepgramService.enrollmentStatus();
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }

  async clearEnrollment(req, res) {
    try {
      const result = await deepgramService.clearEnrollment();
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }
}

export default new DeepgramController();
