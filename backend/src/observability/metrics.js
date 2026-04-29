/**
 * OBSERVABILITY MODULE
 * - Tracks signals/sec throughput
 * - Prints metrics to console every 5 seconds
 * - Exposed via /health endpoint
 */

const logger = require('../config/logger');
const { getHealthStatus, redis } = require('../config/db');
const { buffer } = require('../ingestion/RingBuffer');

let signalCount   = 0;
let totalSignals  = 0;
let startTime     = Date.now();
let currentRate   = 0;

const incrementSignalCount = () => {
  signalCount++;
  totalSignals++;
};

// Print throughput every 5 seconds
const startMetricsLoop = () => {
  setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    currentRate   = Math.round(signalCount / 5);
    signalCount   = 0;
    startTime     = Date.now();

    const health  = getHealthStatus();
    const bufLen  = buffer.length;
    const dropped = buffer.dropped;

    logger.info(
      `📊 METRICS | Rate: ${currentRate} sig/s | Total: ${totalSignals} | ` +
      `Buffer: ${bufLen} | Dropped: ${dropped} | ` +
      `DB: mongo=${health.mongo} pg=${health.postgres} redis=${health.redis}`
    );

    // Push metrics to Redis for dashboard consumption
    await redis.setex('metrics:latest', 10, JSON.stringify({
      rate:        currentRate,
      total:       totalSignals,
      bufferSize:  bufLen,
      dropped,
      uptime:      Math.round(process.uptime()),
      health
    })).catch(() => {});

  }, 5000);

  logger.info('Metrics loop started (5s interval)');
};

const getMetrics = async () => {
  const cached = await redis.get('metrics:latest').catch(() => null);
  if (cached) return JSON.parse(cached);
  return {
    rate:       currentRate,
    total:      totalSignals,
    bufferSize: buffer.length,
    dropped:    buffer.dropped,
    uptime:     Math.round(process.uptime()),
    health:     getHealthStatus()
  };
};

module.exports = { incrementSignalCount, startMetricsLoop, getMetrics };
