const mongoose = require('mongoose');
const { Pool } = require('pg');
const Redis = require('ioredis');
const logger = require('./logger');

// ── MongoDB (NoSQL - raw signal audit log) ──────────────────────────────────
let mongoConnected = false;
const connectMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/ims_signals');
    mongoConnected = true;
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error(`MongoDB connection failed: ${err.message}`);
  }
};

// ── PostgreSQL (RDBMS - Work Items & RCA, transactional) ────────────────────
const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URI || 'postgresql://ims_user:ims_pass@postgres:5432/ims_workitems',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

let pgConnected = false;
const connectPostgres = async () => {
  try {
    const client = await pgPool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_items (
        id UUID PRIMARY KEY,
        component_id TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        signal_count INTEGER DEFAULT 1,
        start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rca_records (
        id UUID PRIMARY KEY,
        work_item_id UUID REFERENCES work_items(id),
        incident_start TIMESTAMPTZ NOT NULL,
        incident_end TIMESTAMPTZ NOT NULL,
        root_cause_category TEXT NOT NULL,
        fix_applied TEXT NOT NULL,
        prevention_steps TEXT NOT NULL,
        mttr_seconds INTEGER NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    client.release();
    pgConnected = true;
    logger.info('PostgreSQL connected and tables ready');
  } catch (err) {
    logger.error(`PostgreSQL connection failed: ${err.message}`);
  }
};

// ── Redis (Cache - real-time dashboard hot path) ────────────────────────────
const redis = new Redis(process.env.REDIS_URI || 'redis://redis:6379', {
  retryStrategy: (times) => Math.min(times * 100, 3000),
  lazyConnect: true
});

let redisConnected = false;
redis.on('connect', () => { redisConnected = true; logger.info('Redis connected'); });
redis.on('error', (err) => logger.error(`Redis error: ${err.message}`));

const connectRedis = async () => {
  try {
    await redis.connect();
  } catch (err) {
    logger.error(`Redis connection failed: ${err.message}`);
  }
};

const getHealthStatus = () => ({
  mongo: mongoConnected,
  postgres: pgConnected,
  redis: redisConnected
});

module.exports = { connectMongo, connectPostgres, connectRedis, pgPool, redis, getHealthStatus };
