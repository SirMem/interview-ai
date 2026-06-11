/**
 * TelemetryService — 遥测配置管理
 *
 * 处理 OpenTelemetry → Grafana Cloud 的配置校验、启用/关闭、Grafana Dashboard 导入。
 */

import logger from '../../utils/logger.js';

const log = logger('TelemetryService');

class TelemetryService {
  /**
   * 读取当前 telemetry 配置
   * @returns {object}
   */
  readConfig() {
    // TODO: 移植自 ConfigController.getTelemetryStatus()
    throw new Error('Not implemented');
  }

  /**
   * 校验 OTLP 端点 + 保存配置 + 重载
   * @param {object} config
   * @returns {Promise<object>}
   */
  async saveAndReload(config) {
    // TODO: 移植自 ConfigController.saveAndReloadTelemetry()
    throw new Error('Not implemented');
  }

  /**
   * 向 Grafana 导入仪表盘
   * @param {string} grafanaUrl
   * @param {string} saToken
   * @returns {Promise<object>}
   */
  async importDashboard(grafanaUrl, saToken) {
    // TODO: 移植自 ConfigController.importDashboardToGrafana()
    throw new Error('Not implemented');
  }

  /** 通知 Python 端重载 telemetry 配置 */
  async _reloadPython() {
    const resp = await fetch('http://localhost:8000/reload-telemetry', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return resp ? resp.json().catch(() => ({})) : { ok: false };
  }
}

export default new TelemetryService();
