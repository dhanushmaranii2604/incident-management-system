/**
 * DEBOUNCE ENGINE
 *
 * Rule: If 100 signals arrive for the same component_id within 10 seconds,
 * only ONE Work Item is created. All signals are linked to it.
 *
 * Implementation: sliding window per component_id using an in-process Map.
 * Window resets after DEBOUNCE_WINDOW_SEC of inactivity.
 */

const { v4: uuidv4 } = require('uuid');
const { pgPool, redis } = require('../config/db');
const { getAlertStrategy } = require('../workflow/AlertStrategy');
const logger = require('../config/logger');

const DEBOUNCE_WINDOW_SEC  = parseInt(process.env.DEBOUNCE_WINDOW_SEC  || '10');
const DEBOUNCE_THRESHOLD   = parseInt(process.env.DEBOUNCE_THRESHOLD   || '100');

// Map<componentId, { workItemId, count, windowStart, timer }>
const debounceMap = new Map();

/**
 * Process one signal through the debounce engine.
 * Returns the work_item_id that this signal is linked to.
 */
const processSignal = async (signalData) => {
  const { component_id, component_type } = signalData;
  const now = Date.now();

  let entry = debounceMap.get(component_id);

  if (!entry) {
    // First signal for this component — start a new window
    const workItemId = uuidv4();
    const strategy   = getAlertStrategy(component_type);

    entry = {
      workItemId,
      count:       1,
      windowStart: now,
      priority:    strategy.getPriority(),
      channel:     strategy.getChannel(),
      timer:       null
    };

    // Create Work Item in PostgreSQL
    await createWorkItem(workItemId, component_id, strategy.getPriority());

    // Set window expiry — clear entry after DEBOUNCE_WINDOW_SEC inactivity
    entry.timer = setTimeout(() => {
      debounceMap.delete(component_id);
    }, DEBOUNCE_WINDOW_SEC * 1000);

    debounceMap.set(component_id, entry);
    logger.info(`New Work Item ${workItemId} for ${component_id} [${strategy.getPriority()}]`);

  } else {
    // Existing window — increment count
    entry.count++;

    // Reset inactivity timer
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      debounceMap.delete(component_id);
    }, DEBOUNCE_WINDOW_SEC * 1000);

    if (entry.count === DEBOUNCE_THRESHOLD) {
      logger.warn(`Debounce threshold hit for ${component_id} (${entry.count} signals) — still linked to ${entry.workItemId}`);
    }

    // Update signal_count in PostgreSQL (non-blocking)
    pgPool.query(
      'UPDATE work_items SET signal_count = $1, updated_at = NOW() WHERE id = $2',
      [entry.count, entry.workItemId]
    ).catch(err => logger.error(`PG signal_count update failed: ${err.message}`));
  }

  // Invalidate Redis cache for this work item (force fresh read next dashboard poll)
  redis.del(`workitem:${entry.workItemId}`).catch(() => {});
  redis.del('dashboard:summary').catch(() => {});

  return entry.workItemId;
};

/**
 * Insert a new Work Item row in PostgreSQL (transactional).
 */
const createWorkItem = async (id, componentId, priority) => {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO work_items (id, component_id, priority, status, signal_count, start_time, updated_at)
       VALUES ($1, $2, $3, 'OPEN', 1, NOW(), NOW())`,
      [id, componentId, priority]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { processSignal };
