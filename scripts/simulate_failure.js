#!/usr/bin/env node
/**
 * MOCK FAILURE SIMULATION SCRIPT
 *
 * Simulates a real-world scenario:
 *   1. RDBMS outage (P0) — 80 signals over 8 seconds
 *   2. MCP Host failure triggered by DB (P0) — 60 signals over 6 seconds
 *   3. Cache degradation as fallout (P2) — 30 signals
 *
 * Usage:
 *   node scripts/simulate_failure.js [--url http://localhost:4000]
 */

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:4000';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const send = async (signal) => {
  const res = await fetch(`${BASE_URL}/api/signals`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(signal)
  });
  return res.json();
};

const burst = async (componentId, componentType, message, errorCode, count, intervalMs) => {
  console.log(`\n📡 Sending ${count} signals for ${componentId} (${componentType})...`);
  for (let i = 0; i < count; i++) {
    await send({
      component_id:   componentId,
      component_type: componentType,
      message:        `${message} [${i + 1}/${count}]`,
      error_code:     errorCode,
      metadata: { host: `node-0${(i % 3) + 1}`, attempt: i + 1 }
    });
    process.stdout.write('.');
    await sleep(intervalMs);
  }
  console.log(`\n✅ Done: ${componentId}`);
};

(async () => {
  console.log('═══════════════════════════════════════');
  console.log('  IMS Failure Simulation Script');
  console.log(`  Target: ${BASE_URL}`);
  console.log('═══════════════════════════════════════\n');

  // Check health first
  try {
    const health = await fetch(`${BASE_URL}/health`).then(r => r.json());
    console.log('🟢 Backend health:', health.status);
  } catch {
    console.error('❌ Cannot reach backend. Is it running?');
    process.exit(1);
  }

  // ── Phase 1: RDBMS Outage (P0) ──────────────────────────────────────────
  console.log('\n🔴 PHASE 1: RDBMS Primary Node Down');
  await burst(
    'POSTGRES_PRIMARY_01',
    'RDBMS',
    'Connection timeout: primary node unreachable',
    'CONN_TIMEOUT_5000',
    85,  // > DEBOUNCE_THRESHOLD — all link to 1 work item
    90
  );

  await sleep(1000);

  // ── Phase 2: MCP Host Failure (cascading) ───────────────────────────────
  console.log('\n🟠 PHASE 2: MCP Host Failure (cascading from DB)');
  await burst(
    'MCP_HOST_CLUSTER_A',
    'MCP',
    'Orchestration breakdown: cannot reach data store',
    'MCP_STORE_UNREACHABLE',
    65,
    100
  );

  await sleep(500);

  // ── Phase 3: Cache Degradation (P2) ─────────────────────────────────────
  console.log('\n🟡 PHASE 3: Cache Cluster Degraded');
  await burst(
    'CACHE_CLUSTER_01',
    'CACHE',
    'Cache miss rate > 95%, fallback to cold storage',
    'CACHE_MISS_HIGH',
    30,
    150
  );

  await sleep(500);

  // ── Phase 4: Queue Backing Up ────────────────────────────────────────────
  console.log('\n🟠 PHASE 4: Async Queue Backing Up');
  await burst(
    'QUEUE_WORKER_02',
    'QUEUE',
    'Queue depth exceeded 50k, consumers blocked',
    'QUEUE_OVERFLOW',
    45,
    120
  );

  console.log('\n\n═══════════════════════════════════════');
  console.log('  Simulation complete!');
  console.log('  Visit http://localhost:3000 to see incidents');
  console.log('═══════════════════════════════════════');
})();
