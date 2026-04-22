/**
 * Apply optional `config` to a `TelemetryClient`.
 * @param {{ config?: Record<string, any>, getStatsbeat?: () => { enable(state: boolean): void }, initialize?: () => void }} client
 * @param {Record<string, any> | undefined} config
 */
export function applyClientConfig(client, config) {
  if (config) {
    if (config.disableStatsbeat) {
      const statsbeat = typeof client.getStatsbeat === 'function' ? client.getStatsbeat() : null;
      if (statsbeat && typeof statsbeat.enable === 'function') statsbeat.enable(false);
    }

    if (client.config && typeof client.config === 'object') {
      Object.assign(client.config, config);
    }
  }

  if (typeof client.initialize === 'function') client.initialize();
}
