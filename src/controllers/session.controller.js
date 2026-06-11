import sessionService, { SessionValidationError, TurnValidationError } from '../services/session.service.js';
import { sendSuccess, sendError } from '../lib/response.js';
import { badRequest, notFound } from '../lib/errors.js';
import logger from '../utils/logger.js';

const log = logger('SessionController');

export class SessionController {
  constructor(service = sessionService) {
    this.service = service;
  }

  create(req, res, next) {
    try {
      const session = this.service.createSession(req.body || {});
      return sendSuccess(res, { session }, { status: 201 });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error creating session', { error: err.message });
      return sendError(res, err);
    }
  }

  list(req, res, next) {
    try {
      const result = this.service.listSessions({
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return sendSuccess(res, result);
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error listing sessions', { error: err.message });
      return sendError(res, err);
    }
  }

  get(req, res, next) {
    try {
      const session = this.service.getSession(req.params.id);
      if (!session) throw notFound(`Session "${req.params.id}" not found`);
      return sendSuccess(res, { session });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error getting session', { sessionId: req.params.id, error: err.message });
      return sendError(res, err);
    }
  }

  getTurns(req, res, next) {
    try {
      const session = this.service.getSession(req.params.id);
      if (!session) throw notFound(`Session "${req.params.id}" not found`);
      const turns = this.service.getTurns(req.params.id);
      return sendSuccess(res, { session_id: req.params.id, turns });
    } catch (err) {
      if (err instanceof SessionValidationError || err instanceof TurnValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error getting turns', { sessionId: req.params.id, error: err.message });
      return sendError(res, err);
    }
  }

  search(req, res, next) {
    try {
      const query = req.query.q;
      if (!query || !query.trim()) {
        throw badRequest('Search query "q" is required');
      }
      const result = this.service.searchTurns(query.trim(), {
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return sendSuccess(res, result);
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error searching sessions', { error: err.message });
      return sendError(res, err);
    }
  }

  end(req, res, next) {
    try {
      const session = this.service.endSession(req.params.id);
      if (!session) throw notFound(`Session "${req.params.id}" not found`);
      return sendSuccess(res, { session });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return sendError(res, badRequest(err.message));
      }
      log.error('Error ending session', { sessionId: req.params.id, error: err.message });
      return sendError(res, err);
    }
  }
}

export default new SessionController();
