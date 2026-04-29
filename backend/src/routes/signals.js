const express  = require('express');
const router   = express.Router();
const Joi      = require('joi');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const { buffer }              = require('../ingestion/RingBuffer');
const { processSignal }       = require('../ingestion/DebounceEngine');
const { incrementSignalCount } = require('../observability/metrics');
const logger                  = require('../config/logger');

// ── Per-route rate limiter (prevent ingestion DDoS) ────────────────────────
const ingestionLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '5000'),
  message:  { error: 'Too many signals. Slow down ingestion.' },
  standardHeaders: true,
  legacyHeaders:   false
});

// ── Joi validation schema ───────────────────────────────────────────────────
const signalSchema = Joi.object({
  component_id:   Joi.string().required(),
  component_type: Joi.string().valid('API','CACHE','RDBMS','QUEUE','MCP','NOSQL').required(),
  message:        Joi.string().required(),
  error_code:     Joi.string().optional(),
  metadata:       Joi.object().optional()
});

/**
 * POST /api/signals
 * Ingest a single signal. Returns immediately after buffering (async).
 */
router.post('/', ingestionLimiter, async (req, res) => {
  const { error, value } = signalSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const strategy = require('../workflow/AlertStrategy').getAlertStrategy(value.component_type);

  const signal = {
    signal_id:      uuidv4(),
    component_id:   value.component_id,
    component_type: value.component_type,
    message:        value.message,
    error_code:     value.error_code || null,
    severity:       strategy.getPriority(),
    metadata:       value.metadata || {},
    received_at:    new Date()
  };

  // ── Step 1: Buffer immediately (non-blocking, prevents crash on DB slowness)
  buffer.push(signal);
  incrementSignalCount();

  // ── Step 2: Debounce asynchronously (attach work_item_id)
  processSignal(signal).then(workItemId => {
    signal.work_item_id = workItemId;
  }).catch(err => logger.error(`Debounce error: ${err.message}`));

  res.status(202).json({ accepted: true, signal_id: signal.signal_id });
});

/**
 * POST /api/signals/batch
 * Ingest multiple signals in one request (up to 1000).
 */
router.post('/batch', ingestionLimiter, async (req, res) => {
  const signals = req.body;
  if (!Array.isArray(signals) || signals.length === 0) {
    return res.status(400).json({ error: 'Body must be a non-empty array of signals' });
  }
  if (signals.length > 1000) {
    return res.status(400).json({ error: 'Batch limit is 1000 signals per request' });
  }

  let accepted = 0;
  for (const raw of signals) {
    const { error, value } = signalSchema.validate(raw);
    if (error) continue;

    const strategy = require('../workflow/AlertStrategy').getAlertStrategy(value.component_type);
    const signal = {
      signal_id:      uuidv4(),
      component_id:   value.component_id,
      component_type: value.component_type,
      message:        value.message,
      error_code:     value.error_code || null,
      severity:       strategy.getPriority(),
      metadata:       value.metadata || {},
      received_at:    new Date()
    };
    buffer.push(signal);
    incrementSignalCount();
    processSignal(signal).catch(() => {});
    accepted++;
  }

  res.status(202).json({ accepted, total: signals.length });
});

module.exports = router;
