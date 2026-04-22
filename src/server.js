import http from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import screenshotMonitorService from './services/screenshot-monitor.service.js';
import DataHandler from './sockets/dataHandler.js';
import imageProcessingService from './services/image-processing.service.js';
import { CONFIG, getLocalIP } from './config/constants.js';
import logger from './utils/logger.js';
import { initTelemetry, shutdownTelemetry, startSystemMetricsSampler, isEnabled as isTelemetryEnabled, logEvent } from './utils/telemetry.js';

const log = logger('Server');

// ── Telemetry — read config and initialize OTel exporters at startup ─────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(async () => {
  try {
    const cfgPath = path.join(__dirname, '..', 'config', 'api-keys.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    await initTelemetry(cfg);
    if (isTelemetryEnabled()) {
      // Background sampler emits host_cpu_percent / host_memory_* / gpu_* gauges
      // every 10 s. Cheap, and stays no-op if telemetry is disabled.
      startSystemMetricsSampler(10).catch((e) =>
        console.warn(`[server] system-metrics sampler failed to start: ${e.message}`),
      );
    }
  } catch (e) {
    // Missing config is fine — telemetry just stays disabled.
    console.warn(`[server] telemetry init skipped: ${e.message}`);
  }
})();

// Initialize services
try {
  screenshotMonitorService.start();
  log.debug('Screenshot monitoring service started');
} catch (error) {
  log.error('Failed to start screenshot monitoring service', error);
}

// HTTP server
const httpServer = http.createServer(app);

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket'],
  allowEIO3: true,
});

// Setup WebSocket handlers
const dataHandler = new DataHandler(io);
imageProcessingService.setDataHandlers([dataHandler]);

const _serverStartTime = Date.now();

httpServer.listen(CONFIG.PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  log.info('Server started');
  log.info(
    `API: http://localhost:${CONFIG.PORT} | http://${localIP}:${CONFIG.PORT}`,
  );
  log.info(
    `Data Updates: ws://localhost:${CONFIG.PORT}/data-updates | ws://${localIP}:${CONFIG.PORT}/data-updates`,
  );
  logEvent('server_start', 'INFO', {
    port:         CONFIG.PORT,
    pid:          process.pid,
    node_version: process.version,
    platform:     process.platform,
    start_time:   new Date().toISOString(),
  });
});

// Graceful shutdown handlers
const gracefulShutdown = () => {
  log.info('Shutting down...');
  screenshotMonitorService.stop && screenshotMonitorService.stop();

  logEvent('server_stop', 'INFO', {
    pid:            process.pid,
    uptime_seconds: Math.round((Date.now() - _serverStartTime) / 1000),
    stop_time:      new Date().toISOString(),
  });

  // Flush any pending OTel batches before exit. shutdownTelemetry resolves once
  // metric/log providers are flushed; failures are swallowed so we still exit.
  shutdownTelemetry().catch(() => {}).finally(() => {
    if (httpServer) {
      httpServer.close(() => {
        log.info('Server closed');
        process.exit(0);
      });
    }
  });

  setTimeout(() => {
    log.warn('Force exit');
    process.exit(1);
  }, 5000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
