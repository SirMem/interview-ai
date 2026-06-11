import imageProcessingService from '../services/image-processing.service.js';
import { sendSuccess, sendError } from '../lib/response.js';
import { badRequest, internal } from '../lib/errors.js';

class ContextController {
  getContextState(req, res, next) {
    try {
      const useContextEnabled = imageProcessingService.getUseContextEnabled();
      return sendSuccess(res, { useContextEnabled });
    } catch (err) {
      return sendError(res, internal('Failed to get context state'));
    }
  }

  updateContextState(req, res, next) {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        throw badRequest('"enabled" must be a boolean');
      }
      imageProcessingService.setUseContextEnabled(enabled);
      return sendSuccess(res, { useContextEnabled: enabled });
    } catch (err) {
      return sendError(res, err);
    }
  }
}

export default new ContextController();
