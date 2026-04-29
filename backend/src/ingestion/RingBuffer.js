/**
 * RING BUFFER — Backpressure / In-Memory Queue
 *
 * When the persistence layer is slow (DB write latency spikes),
 * signals are held in this fixed-size ring buffer instead of being
 * dropped or crashing the process.
 *
 * Capacity: 50,000 signals (covers ~5s of 10k/s burst)
 * If the buffer is full, the OLDEST signal is overwritten (ring semantics).
 * A dedicated drain loop flushes batches to MongoDB asynchronously.
 */

const logger = require('../config/logger');
const Signal = require('../models/Signal');

const BUFFER_CAPACITY = 50_000;
const DRAIN_BATCH     = 500;     // signals per DB write batch
const DRAIN_INTERVAL  = 100;     // ms between drain cycles

class RingBuffer {
  constructor(capacity = BUFFER_CAPACITY) {
    this.capacity  = capacity;
    this.buffer    = new Array(capacity);
    this.head      = 0;   // next write position
    this.tail      = 0;   // next read position
    this.size      = 0;
    this.dropped   = 0;   // count of overwritten signals (observable metric)
  }

  push(item) {
    if (this.size === this.capacity) {
      // Overwrite oldest — ring semantics
      this.tail = (this.tail + 1) % this.capacity;
      this.dropped++;
    } else {
      this.size++;
    }
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }

  pop() {
    if (this.size === 0) return null;
    const item = this.buffer[this.tail];
    this.tail = (this.tail + 1) % this.capacity;
    this.size--;
    return item;
  }

  popBatch(n) {
    const batch = [];
    for (let i = 0; i < n && this.size > 0; i++) {
      batch.push(this.pop());
    }
    return batch;
  }

  get length() { return this.size; }
}

// ── Singleton buffer + drain loop ──────────────────────────────────────────
const buffer = new RingBuffer();
let draining = false;

const startDrainLoop = () => {
  if (draining) return;
  draining = true;

  const drain = async () => {
    if (buffer.length > 0) {
      const batch = buffer.popBatch(DRAIN_BATCH);
      try {
        await Signal.insertMany(batch, { ordered: false });
      } catch (err) {
        // Re-queue on failure (best-effort retry)
        logger.warn(`Drain batch failed, re-queuing ${batch.length} signals: ${err.message}`);
        batch.forEach(s => buffer.push(s));
      }
    }
    setTimeout(drain, DRAIN_INTERVAL);
  };

  drain();
  logger.info('Signal drain loop started');
};

module.exports = { buffer, startDrainLoop };
