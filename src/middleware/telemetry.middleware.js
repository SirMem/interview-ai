/**
 * HTTP request timing middleware.
 * Records `http_request_duration_ms` for every Express request, labeled with
 * { method, route, status_code }. Uses route templates (e.g. "/api/config/full")
 * rather than full URLs so the metric cardinality stays bounded.
 *
 * Wired in src/app.js as the first piece of middleware.
 */
import { recordHistogram } from '../utils/telemetry.js';

export function httpTelemetryMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    // Express resolves req.route only after the matching route handler runs,
    // so we read it from the route layer that handled the request. Falls back
    // to the path with numeric IDs collapsed (avoids cardinality blowup from
    // user-supplied IDs in URLs).
    const route = req.route?.path
      ?? req.baseUrl + (req.route?.path ?? req.path)
      ?? req.path;
    recordHistogram('http_request_duration_ms', durationMs, {
      method:      req.method,
      route:       _normalizeRoute(route || req.path),
      status_code: String(res.statusCode),
    });
  });

  next();
}

/** Collapse high-cardinality URL fragments (numeric IDs, UUIDs) to placeholders. */
function _normalizeRoute(route) {
  if (!route || typeof route !== 'string') return 'unknown';
  return route
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid');
}
