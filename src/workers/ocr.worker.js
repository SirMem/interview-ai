/**
 * OCR Worker Thread
 * Runs Tesseract.js and image cropping off the main event loop.
 * Receives { imagePath, coordinates } via workerData, posts { text } or { error } back.
 */
import { parentPort, workerData } from 'worker_threads';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import path from 'path';

const { imagePath, coordinates } = workerData;

async function runOCR() {
  let imageToProcess = imagePath;
  let croppedImagePath = null;

  if (coordinates) {
    try {
      const imageMetadata = await sharp(imagePath).metadata();
      const screenshotWidth = imageMetadata.width;
      const screenshotHeight = imageMetadata.height;

      const si = await import('systeminformation');
      const graphics = await si.default.graphics();
      const primaryDisplay = graphics.displays && graphics.displays[0];
      let screenWidth = primaryDisplay?.currentResX || primaryDisplay?.resolutionX;
      let screenHeight = primaryDisplay?.currentResY || primaryDisplay?.resolutionY;

      if (!screenWidth || !screenHeight) {
        const likelyRetina = screenshotWidth > 2000 || screenshotHeight > 2000;
        screenWidth = likelyRetina ? screenshotWidth / 2 : screenshotWidth;
        screenHeight = likelyRetina ? screenshotHeight / 2 : screenshotHeight;
      }

      let scaleFactor = screenshotWidth / screenWidth;
      const scaleFactorY = screenshotHeight / screenHeight;
      if (Math.abs(scaleFactor - scaleFactorY) > 0.1) {
        scaleFactor = (scaleFactor + scaleFactorY) / 2;
      }

      const scaledX = coordinates.x * scaleFactor;
      const scaledY = coordinates.y * scaleFactor;
      const scaledWidth = coordinates.width * scaleFactor;
      const scaledHeight = coordinates.height * scaleFactor;

      let x = Math.round(scaledX);
      let y = Math.round(scaledY);
      let w = Math.round(scaledWidth);
      let h = Math.round(scaledHeight);

      x = Math.max(0, Math.min(x, screenshotWidth - 1));
      y = Math.max(0, Math.min(y, screenshotHeight - 1));
      w = Math.max(1, Math.min(w, screenshotWidth - x));
      h = Math.max(1, Math.min(h, screenshotHeight - y));

      const originalDir = path.dirname(imagePath);
      const originalName = path.basename(imagePath, path.extname(imagePath));
      const ext = path.extname(imagePath);
      croppedImagePath = path.join(
        originalDir,
        `${originalName}_cropped_x${x}_y${y}_w${w}_h${h}${ext}`,
      );

      await sharp(imagePath)
        .extract({ left: x, top: y, width: w, height: h })
        .toFile(croppedImagePath);

      imageToProcess = croppedImagePath;
    } catch (cropError) {
      // Fall back to full image
      imageToProcess = imagePath;
    }
  }

  const textData = await Tesseract.recognize(imageToProcess, 'eng');
  return textData.data.text;
}

runOCR()
  .then((text) => parentPort.postMessage({ text }))
  .catch((err) => parentPort.postMessage({ text: '', error: err.message }));
