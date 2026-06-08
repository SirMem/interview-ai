import sessionService, { SessionValidationError, TurnValidationError } from '../services/session.service.js';
import logger from '../utils/logger.js';

const log = logger('SessionController');

export class SessionController {
  constructor(service = sessionService) {
    this.service = service;
  }

  create(req, res) {
    try {
      const session = this.service.createSession(req.body || {});
      res.status(201).json({ success: true, session });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      log.error('Error creating session', { error: err.message });
      res.status(500).json({ success: false, error: 'Failed to create session' });
    }
  }

  list(req, res) {
    try {
      const result = this.service.listSessions({
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      log.error('Error listing sessions', { error: err.message });
      res.status(500).json({ success: false, error: 'Failed to list sessions' });
    }
  }

  get(req, res) {
    try {
      const session = this.service.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, error: `Session "${req.params.id}" not found` });
      }
      res.json({ success: true, session });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      log.error('Error getting session', { sessionId: req.params.id, error: err.message });
      res.status(500).json({ success: false, error: 'Failed to get session' });
    }
  }

  getTurns(req, res) {
    try {
      const session = this.service.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, error: `Session "${req.params.id}" not found` });
      }
      const turns = this.service.getTurns(req.params.id);
      res.json({ success: true, session_id: req.params.id, turns });
    } catch (err) {
      if (err instanceof SessionValidationError || err instanceof TurnValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      log.error('Error getting turns', { sessionId: req.params.id, error: err.message });
      res.status(500).json({ success: false, error: 'Failed to get turns' });
    }
  }

  end(req, res) {
    try {
      const session = this.service.endSession(req.params.id);
      if (!session) {
        return res.status(404).json({ success: false, error: `Session "${req.params.id}" not found` });
      }
      res.json({ success: true, session });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return res.status(400).json({ success: false, error: err.message });
      }
      log.error('Error ending session', { sessionId: req.params.id, error: err.message });
      res.status(500).json({ success: false, error: 'Failed to end session' });
    }
  }
}

export default new SessionController();
