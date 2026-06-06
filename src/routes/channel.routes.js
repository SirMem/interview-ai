import express from 'express';
import channelController from '../controllers/channel.controller.js';

const router = express.Router();

// Channel CRUD
router.get('/channels',           (req, res) => channelController.list(req, res));
router.post('/channels',          (req, res) => channelController.create(req, res));
router.get('/channels/:name',     (req, res) => channelController.get(req, res));
router.put('/channels/:name',     (req, res) => channelController.update(req, res));
router.delete('/channels/:name',  (req, res) => channelController.delete(req, res));

// Channel operations
router.patch('/channels/:name/status', (req, res) => channelController.setStatus(req, res));
router.post('/channels/reorder',        (req, res) => channelController.reorder(req, res));

// Test & models
router.post('/channels/test',          (req, res) => channelController.test(req, res));
router.get('/channels/:name/models',   (req, res) => channelController.listModels(req, res));

export default router;
