import express from 'express';
import configController from '../controllers/config.controller.js';

const router = express.Router();

// ── Legacy key management ─────────────────────────────────────────────
router.get('/config/keys', (req, res) => configController.getApiKeys(req, res));
router.post('/config/keys', (req, res) => configController.saveApiKeys(req, res));

// ── Full settings (read + write) ──────────────────────────────────────
router.get('/config/full', (req, res) => configController.getFullConfig(req, res));
router.post('/config/full', (req, res) => configController.saveFullConfig(req, res));

export default router;
