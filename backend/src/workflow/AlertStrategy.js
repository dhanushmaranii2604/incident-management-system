/**
 * STRATEGY PATTERN — Alerting
 * Each component type maps to a concrete strategy that determines
 * priority and notification channel. Swap strategies at runtime
 * without changing the caller.
 */

class AlertStrategy {
  getPriority()      { throw new Error('getPriority() must be implemented'); }
  getChannel()       { throw new Error('getChannel() must be implemented'); }
  formatMessage(componentId, message) {
    return `[${this.getPriority()}] ${componentId}: ${message}`;
  }
}

// P0 — Database failure is critical (data loss risk)
class RDBMSAlertStrategy extends AlertStrategy {
  getPriority() { return 'P0'; }
  getChannel()  { return ['pagerduty', 'slack', 'sms']; }
}

// P0 — MCP Host failure (orchestration breakdown)
class MCPAlertStrategy extends AlertStrategy {
  getPriority() { return 'P0'; }
  getChannel()  { return ['pagerduty', 'slack']; }
}

// P1 — Async queue failure (delayed but serious)
class QueueAlertStrategy extends AlertStrategy {
  getPriority() { return 'P1'; }
  getChannel()  { return ['pagerduty', 'slack']; }
}

// P1 — API failure
class APIAlertStrategy extends AlertStrategy {
  getPriority() { return 'P1'; }
  getChannel()  { return ['slack', 'email']; }
}

// P2 — Cache failure (degraded performance, not critical)
class CacheAlertStrategy extends AlertStrategy {
  getPriority() { return 'P2'; }
  getChannel()  { return ['slack']; }
}

// P3 — NoSQL degraded (partial availability)
class NoSQLAlertStrategy extends AlertStrategy {
  getPriority() { return 'P3'; }
  getChannel()  { return ['slack']; }
}

// Default fallback
class DefaultAlertStrategy extends AlertStrategy {
  getPriority() { return 'P2'; }
  getChannel()  { return ['slack']; }
}

// ── Registry: maps component_type → strategy ───────────────────────────────
const STRATEGY_MAP = {
  RDBMS:  new RDBMSAlertStrategy(),
  MCP:    new MCPAlertStrategy(),
  QUEUE:  new QueueAlertStrategy(),
  API:    new APIAlertStrategy(),
  CACHE:  new CacheAlertStrategy(),
  NOSQL:  new NoSQLAlertStrategy()
};

/**
 * Factory: returns the correct strategy for a component type.
 * Adding a new component type = add one line here.
 */
const getAlertStrategy = (componentType) => {
  return STRATEGY_MAP[componentType?.toUpperCase()] || new DefaultAlertStrategy();
};

module.exports = { getAlertStrategy };
