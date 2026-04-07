import os from 'os';
import path from 'path';
import { readFileSync } from 'fs';

function loadAppConfig() {
  try {
    return JSON.parse(readFileSync(new URL('../../config/api-keys.json', import.meta.url)));
  } catch { return {}; }
}

const _cfg = loadAppConfig();

export const CONFIG = {
  PORT: _cfg.port || 4000,
  FUNCTION_INTERVAL: _cfg.function_interval || 5000,
  SCREENSHOTS_PATH: _cfg.screenshots_path || '/Users/parmeet1.0/Documents/screenshots',
  UPLOAD_DIR: path.join(process.cwd(), 'uploads'),
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_IMAGE_TYPES: /jpeg|jpg|png|gif|bmp|webp/,
  BLACKLISTED_FILES: ['.DS_Store'],
  REFRESH_INTERVAL: 2000, // COMMENTED OUT: Frontend removed - 2 seconds for frontend refresh (no longer used)
};

export const getLocalIP = () => {
  const networkInterfaces = os.networkInterfaces();
  let localIP = 'localhost';

  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
    if (localIP !== 'localhost') break;
  }

  return localIP;
};
