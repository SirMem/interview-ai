/**
 * TelemetryController — OpenTelemetry → Grafana 配置 API
 *
 * 处理 /api/telemetry/*
 */

import telemetryService from '../../services/config/telemetry.service.js';
import { sendSuccess, sendError } from '../../lib/response.js';

class TelemetryController {
  async getStatus(req, res) {
    try {
      const status = telemetryService.readConfig();
      return sendSuccess(res, status);
    } catch (err) {
      return sendError(res, err);
    }
  }

  async saveAndReload(req, res) {
    try {
      const result = await telemetryService.saveAndReload(req.body);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }

  async importDashboard(req, res) {
    try {
      const { grafana_url, sa_token } = req.body || {};
      const result = await telemetryService.importDashboard(grafana_url, sa_token);
      return sendSuccess(res, result);
    } catch (err) {
      return sendError(res, err);
    }
  }
}

export default new TelemetryController();
