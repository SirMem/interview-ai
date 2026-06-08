import express from 'express';
import sessionController from '../controllers/session.controller.js';

export function createSessionRouter(controller = sessionController) {
  const router = express.Router();

  router.post('/sessions',      (req, res) => controller.create(req, res));
  router.get('/sessions',       (req, res) => controller.list(req, res));
  router.get('/sessions/:id',   (req, res) => controller.get(req, res));
  router.post('/sessions/:id/end', (req, res) => controller.end(req, res));
  router.get('/sessions/:id/turns', (req, res) => controller.getTurns(req, res));

  return router;
}

export default createSessionRouter();
