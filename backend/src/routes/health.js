const express = require('express');
const router  = express.Router();
const { getMetrics } = require('../observability/metrics');

// GET /health — liveness + readiness probe
router.get('/', async (req, res) => {
  const metrics = await getMetrics();
  const allHealthy = Object.values(metrics.health).every(Boolean);

  res.status(allHealthy ? 200 : 207).json({
    status:  allHealthy ? 'healthy' : 'degraded',
    uptime:  metrics.uptime,
    version: '1.0.0',
    db:      metrics.health,
    metrics: {
      signalsPerSec: metrics.rate,
      totalSignals:  metrics.total,
      bufferSize:    metrics.bufferSize,
      droppedSignals: metrics.dropped
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
