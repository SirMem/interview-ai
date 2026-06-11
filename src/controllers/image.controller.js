import fs from 'fs';
import imageProcessingService from '../services/image-processing.service.js';
import { sendSuccess, sendError } from '../lib/response.js';
import { badRequest } from '../lib/errors.js';
import logger from '../utils/logger.js';

const log = logger('ImageController');

class ImageController {
  async uploadImage(req, res, next) {
    if (!req.file) {
      return sendError(res, badRequest('No file uploaded'));
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const useContextEnabled = imageProcessingService.getUseContextEnabled();

    try {
      const result = await imageProcessingService.processImage(
        filePath,
        fileName,
        useContextEnabled,
      );

      // 处理完成后清理临时文件
      fs.unlink(filePath, (err) => {
        if (err) log.error('Error deleting uploaded file', err);
      });

      return sendSuccess(res, {
        filename: fileName,
        extractedText: result.extractedText.substring(0, 200) + '...',
        gptResponse: result.gptResponse.substring(0, 200) + '...',
        usedContext: result.usedContext,
      });
    } catch (err) {
      // 出错时也要清理临时文件
      fs.unlink(filePath, (err) => {
        if (err) log.error('Error deleting uploaded file', err);
      });

      log.error('Error processing image', err);
      return sendError(res, err);
    }
  }

  getProcessedData(req, res, next) {
    try {
      const data = imageProcessingService.getProcessedData();
      return sendSuccess(res, { data });
    } catch (err) {
      log.error('Error serving data', err);
      return sendSuccess(res, { data: [] });
    }
  }
}

export default new ImageController();
