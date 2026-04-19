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

// ── Platform info (OS / Whisper backend) ─────────────────────────────
router.get('/config/platform', (req, res) => configController.getPlatformInfo(req, res));

// ── Whisper model management (local CPU backend) ──────────────────────
router.get('/config/whisper-models', (req, res) => configController.getWhisperModels(req, res));
router.post('/config/whisper-download', (req, res) => configController.downloadWhisperModel(req, res));

export default router;
