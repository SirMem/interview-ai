import os from 'os';
import path from 'path';

export const CONFIG = {
  PORT:             parseInt(process.env.PORT, 10)            || 4000,
  FUNCTION_INTERVAL: 5000,
  SCREENSHOTS_PATH: process.env.SCREENSHOTS_PATH              || null,
  UPLOAD_DIR: path.join(process.cwd(), 'uploads'),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: /jpeg|jpg|png|gif|bmp|webp/,
  BLACKLISTED_FILES: ['.DS_Store'],
  REFRESH_INTERVAL: 2000,
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
