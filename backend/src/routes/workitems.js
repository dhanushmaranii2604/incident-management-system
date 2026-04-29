const express = require('express');
const router  = express.Router();
const Joi     = require('joi');
const { v4: uuidv4 } = require('uuid');

const { pgPool, redis } = require('../config/db');
const Signal            = require('../models/Signal');
const { stateFromString } = require('../workflow/WorkItemState');
const logger            = require('../config/logger');

// ── GET /api/workitems ──────────────────────────────────────────────────────
// Returns all work items sorted by priority + updated_at (for dashboard)
router.get('/', async (req, res) => {
  try {
    // Try Redis cache first (hot path)
    const cached = await redis.get('dashboard:workitems').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const result = await pgPool.query(`
      SELECT * FROM work_items
      ORDER BY
        CASE priority WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 WHEN 'P2' THEN 3 ELSE 4 END,
        updated_at DESC
    `);

    // Cache for 3 seconds (dashboard refresh rate)
    await redis.setex('dashboard:workitems', 3, JSON.stringify(result.rows)).catch(() => {});

    res.json(result.rows);
  } catch (err) {
    logger.error(`GET /workitems: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch work items' });
  }
});

// ── GET /api/workitems/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const cacheKey = `workitem:${req.params.id}`;
    const cached   = await redis.get(cacheKey).catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const wi = await pgPool.query('SELECT * FROM work_items WHERE id = $1', [req.params.id]);
    if (wi.rows.length === 0) return res.status(404).json({ error: 'Work item not found' });

    const rca = await pgPool.query('SELECT * FROM rca_records WHERE work_item_id = $1', [req.params.id]);

    // Fetch linked signals from MongoDB
    const signals = await Signal.find({ work_item_id: req.params.id })
      .sort({ received_at: -1 })
      .limit(200)
      .lean();

    const payload = { ...wi.rows[0], rca: rca.rows[0] || null, signals };
    await redis.setex(cacheKey, 5, JSON.stringify(payload)).catch(() => {});
    res.json(payload);
  } catch (err) {
    logger.error(`GET /workitems/${req.params.id}: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch work item' });
  }
});

// ── PATCH /api/workitems/:id/status ────────────────────────────────────────
// Transition work item status using the State Pattern
const statusSchema = Joi.object({
  status: Joi.string().valid('OPEN','INVESTIGATING','RESOLVED','CLOSED').required(),
  rca:    Joi.object({
    incident_start:       Joi.string().isoDate().required(),
    incident_end:         Joi.string().isoDate().required(),
    root_cause_category:  Joi.string().required(),
    fix_applied:          Joi.string().required(),
    prevention_steps:     Joi.string().required()
  }).optional()
});

router.patch('/:id/status', async (req, res) => {
  const { error, value } = statusSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    const wi = await client.query('SELECT * FROM work_items WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (wi.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Work item not found' });
    }

    const currentState = stateFromString(wi.rows[0].status);
    const nextState    = currentState.transitionTo(value.status, { rca: value.rca });

    // Update status
    await client.query(
      'UPDATE work_items SET status = $1, updated_at = NOW() WHERE id = $2',
      [nextState.toString(), req.params.id]
    );

    // If closing, persist RCA + calculate MTTR
    if (value.status === 'CLOSED' && value.rca) {
      const start  = new Date(value.rca.incident_start);
      const end    = new Date(value.rca.incident_end);
      const mttrSec = Math.round((end - start) / 1000);

      await client.query(
        `INSERT INTO rca_records
          (id, work_item_id, incident_start, incident_end, root_cause_category,
           fix_applied, prevention_steps, mttr_seconds, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          uuidv4(), req.params.id,
          start, end,
          value.rca.root_cause_category,
          value.rca.fix_applied,
          value.rca.prevention_steps,
          mttrSec
        ]
      );
    }

    await client.query('COMMIT');

    // Invalidate Redis caches
    await redis.del(`workitem:${req.params.id}`).catch(() => {});
    await redis.del('dashboard:workitems').catch(() => {});

    res.json({ success: true, status: nextState.toString() });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.message.startsWith('TRANSITION_BLOCKED')) {
      return res.status(422).json({ error: err.message });
    }
    logger.error(`PATCH /workitems/${req.params.id}/status: ${err.message}`);
    res.status(500).json({ error: 'Status transition failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
