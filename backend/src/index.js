require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { WebSocketServer } = require('ws');
const http       = require('http');

const { connectMongo, connectPostgres, connectRedis, redis } = require('./config/db');
const { startDrainLoop }   = require('./ingestion/RingBuffer');
const { startMetricsLoop } = require('./observability/metrics');
const logger               = require('./config/logger');

const signalRoutes   = require('./routes/signals');
const workitemRoutes = require('./routes/workitems');
const healthRoutes   = require('./routes/health');

const app    = express();
const server = http.createServer(app);

// ── Security & Parsing ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// ── Global rate limiter (hard ceiling) ─────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000,
  max:      10_000,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Global rate limit exceeded' }
}));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/signals',   signalRoutes);
app.use('/api/workitems', workitemRoutes);
app.use('/health',        healthRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// ── WebSocket — push dashboard updates to connected clients ────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

const broadcastUpdate = (type, data) => {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
};

// Broadcast work item updates every 3 seconds
setInterval(async () => {
  try {
    const result = await require('./config/db').pgPool.query(`
      SELECT * FROM work_items
      ORDER BY
        CASE priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
        updated_at DESC
      LIMIT 50
    `);
    broadcastUpdate('WORKITEMS_UPDATE', result.rows);
  } catch {}
}, 3000);

wss.on('connection', (ws) => {
  logger.info(`WebSocket client connected (${wss.clients.size} total)`);
  ws.on('close', () => logger.info(`WebSocket client disconnected`));
});

// ── Bootstrap ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

const bootstrap = async () => {
  await connectMongo();
  await connectPostgres();
  await connectRedis();

  startDrainLoop();
  startMetricsLoop();

  server.listen(PORT, () => {
    logger.info(`IMS Backend running on port ${PORT}`);
    logger.info(`Health: http://localhost:${PORT}/health`);
    logger.info(`WS: ws://localhost:${PORT}/ws`);
  });
};

bootstrap().catch(err => {
  logger.error(`Bootstrap failed: ${err.message}`);
  process.exit(1);
});

module.exports = { app, broadcastUpdate };
