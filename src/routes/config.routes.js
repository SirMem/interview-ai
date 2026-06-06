import express from 'express';
import configController from '../controllers/config.controller.js';

const router = express.Router();

// ── Legacy key management ─────────────────────────────────────────────
router.get('/config/keys', (req, res) => configController.getApiKeys(req, res));
router.post('/config/keys', (req, res) => configController.saveApiKeys(req, res));

// ── Full settings (read + write) ──────────────────────────────────────
router.get('/config/full', (req, res) => configController.getFullConfig(req, res));
router.post('/config/full', (req, res) => configController.saveFullConfig(req, res));

// ── Model list for a provider ─────────────────────────────────────────
router.get('/config/models/:providerId', (req, res) => configController.getProviderModels(req, res));

// ── Prompt preview ────────────────────────────────────────────────────
router.get('/config/prompt-preview', (req, res) => configController.getPromptPreview(req, res));

// ── Test provider connection ──────────────────────────────────────────
router.post('/config/test-provider', (req, res) => configController.testProvider(req, res));

// ── Test Deepgram connection ──────────────────────────────────────────
router.post('/config/test-deepgram', (req, res) => configController.testDeepgramKey(req, res));

// ── Reload STT config in Python transcriber ───────────────────────────
router.post('/config/reload-stt', async (req, res) => {
  try {
    const r = await fetch('http://localhost:8000/reload-stt-config', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json().catch(() => ({}));
    return res.json({ success: r.ok, ...data });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// ── Deepgram voice enrollment (proxied to avoid CORS preflight) ───────
router.post('/config/enroll-deepgram-voice', async (req, res) => {
  try {
    const duration = Math.max(5, Math.min(parseInt(req.body?.duration ?? 12, 10), 30));
    const r = await fetch('http://localhost:8000/enroll-deepgram-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration }),
      signal: AbortSignal.timeout((duration + 5) * 1000),
    });
    const data = await r.json().catch(() => ({}));
    return res.status(r.ok ? 200 : 500).json(data);
  } catch (e) {
    return res.status(500).json({ detail: e.message });
  }
});

// ── Deepgram enrollment status (proxied) ──────────────────────────────
router.get('/config/deepgram-enrollment-status', async (req, res) => {
  try {
    const r = await fetch('http://localhost:8000/enrollment-status', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await r.json().catch(() => ({}));
    return res.json(data);
  } catch (e) {
    return res.status(503).json({ error: 'transcriber offline' });
  }
});

// ── Clear Deepgram enrollment (proxied) ───────────────────────────────
router.delete('/config/deepgram-enrollment', async (req, res) => {
  try {
    const r = await fetch('http://localhost:8000/enroll-deepgram-speaker', {
      method: 'DELETE',
      signal: AbortSignal.timeout(3000),
    });
    const data = await r.json().catch(() => ({}));
    return res.json(data);
  } catch (e) {
    return res.status(503).json({ error: 'transcriber offline' });
  }
});

// ── Audio input device list (proxied from Python transcriber) ─────────────
router.get('/config/audio-devices', async (req, res) => {
  try {
    const r = await fetch('http://localhost:8000/audio-devices', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await r.json().catch(() => ({}));
    return res.json({ success: true, ...data });
  } catch (e) {
    return res.json({ success: true, devices: [], current: null, error: e.message });
  }
});

// ── Platform info (OS / Whisper backend) ─────────────────────────────
router.get('/config/platform', (req, res) => configController.getPlatformInfo(req, res));

// ── Whisper model management (local CPU backend) ──────────────────────
router.get('/config/whisper-models', (req, res) => configController.getWhisperModels(req, res));
router.post('/config/whisper-download', (req, res) => configController.downloadWhisperModel(req, res));

// ── Telemetry (OTel → Grafana Cloud) ──────────────────────────────────
router.get('/telemetry/status',           (req, res) => configController.getTelemetryStatus(req, res));
router.post('/telemetry/save-and-reload', (req, res) => configController.saveAndReloadTelemetry(req, res));
router.post('/telemetry/import-dashboard', (req, res) => configController.importDashboardToGrafana(req, res));

export default router;
