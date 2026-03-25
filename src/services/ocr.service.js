import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = logger('OCRService');
const WORKER_PATH = path.join(__dirname, '../workers/ocr.worker.js');

class OCRService {
  /**
   * Extracts text from an image using Tesseract in a worker thread,
   * keeping the main event loop free during the 1–3s OCR operation.
   */
  async extractText(imagePath, coordinates = null) {
    const startTime = Date.now();
    log.info('Starting OCR in worker thread', {
      imagePath,
      usedRegion: coordinates !== null,
    });

    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_PATH, {
        workerData: { imagePath, coordinates },
      });

      worker.on('message', ({ text, error }) => {
        const duration = Date.now() - startTime;
        if (error) {
          log.error('OCR worker reported error', { error, duration: `${duration}ms` });
          reject(new Error(error));
        } else {
          log.info('OCR extraction complete', {
            textLength: text.length,
            duration: `${duration}ms`,
            usedRegion: coordinates !== null,
          });
          resolve(text);
        }
      });

      worker.on('error', (err) => {
        log.error('OCR worker threw an error', { error: err.message });
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`OCR worker exited unexpectedly with code ${code}`));
        }
      });
    });
  }
}

export default new OCRService();
