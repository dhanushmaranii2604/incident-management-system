# Prompts, Spec, and Planning

This document records all planning, specification thinking, and prompts used during development of the IMS, as required by submission guidelines.

---

## 1. Initial Assignment Analysis

**Input (assignment spec summary):**
- Build an Incident Management System for a distributed stack
- Support 10,000 signals/sec ingestion without crashing
- Debounce: 100 signals for same component in 10s → 1 Work Item
- Storage: MongoDB (raw signals), PostgreSQL (work items + RCA), Redis (cache)
- Design Patterns required: Strategy (alerting), State (work item lifecycle)
- Mandatory RCA before CLOSED transition
- MTTR auto-calculation
- React frontend with live feed, incident detail, RCA form
- /health endpoint, throughput metrics every 5s
- Docker Compose deployment

---

## 2. Architecture Decisions

### Why Node.js?
- Native async/await handles I/O concurrency without thread complexity
- Event loop model suits high-throughput signal ingestion
- Single language across codebase (JS frontend + JS backend)

### Why Ring Buffer for backpressure?
- DB writes can spike in latency. If ingestion blocks on DB, the HTTP layer hangs and the process crashes under load.
- Solution: decouple ingestion from persistence using an in-process ring buffer.
- HTTP layer writes to buffer instantly (< 1μs), returns 202.
- Separate drain loop flushes to MongoDB asynchronously.
- If buffer fills (50k cap): ring semantics overwrite oldest entries — process never OOM crashes.

### Why Debounce in-process (Map) vs DB-level?
- DB round-trip per signal would be 2-5ms. At 10k/s that's 10-50 seconds of latency per window.
- In-process Map lookup is < 1μs.
- Trade-off: if the process restarts, the debounce window resets. Acceptable for an SRE internship assignment. Production fix: use Redis for distributed debounce.

### Why PostgreSQL for Work Items?
- Work item status transitions must be atomic (BEGIN/COMMIT/ROLLBACK).
- Can't allow a half-written transition (RESOLVED but RCA not saved).
- `SELECT ... FOR UPDATE` locks the row during transition, preventing race conditions.

### Why MongoDB for Raw Signals?
- Signals are write-heavy, schema-flexible (metadata varies by component type).
- No joins needed — signals are read by work_item_id index.
- TTL index handles automatic data lake retention cleanup.

### Why Redis?
- Dashboard polls can be 1/second per browser tab.
- Querying PostgreSQL on every poll would be wasteful.
- Redis cache (3s TTL) absorbs dashboard read load.
- Also used for metrics push from backend to dashboard.

---

## 3. Design Pattern Specification

### Strategy Pattern — AlertStrategy
**Problem:** Different component types need different P-levels and channels. A switch/if-else would be hard to extend.
**Solution:** Abstract `AlertStrategy` class + concrete subclasses. Registry maps type → strategy.
**Extension:** Add `class NewComponentStrategy extends AlertStrategy` + one registry entry.

### State Pattern — WorkItemState
**Problem:** Work item lifecycle has strict rules. A simple string field allows any transition.
**Solution:** Each state is a class. `transitionTo()` encodes allowed next states. Invalid transition = throw. CLOSED guard requires RCA validation inline.
**Key benefit:** The RCA requirement lives inside `ResolvedState.transitionTo('CLOSED')` — not scattered across the codebase.

---

## 4. Frontend Design Decisions

- Dark industrial theme chosen for SRE/ops context (ops dashboards are always dark)
- Space Mono monospace for IDs, metrics, status badges (terminal aesthetic)
- WebSocket for live updates (polling fallback auto-reconnects if WS drops)
- Sidebar: incident list sorted P0→P3
- Main panel: detail view with raw signals from MongoDB + RCA form
- RCA form validates client-side first, then server-side via State Pattern

---

## 5. Test Strategy

Unit tests focus on the two design patterns and the RCA validation rule:
- All 6 valid state transitions
- All invalid transitions (throw verification)
- RCA validation: null, empty fields, partial completion
- Strategy: priority level per component type
- Strategy: channel list per component type

Integration tests not included (would require running Docker containers). The simulation script serves as an end-to-end smoke test.

---

## 6. Security Layer (Bonus)

- Helmet.js for HTTP security headers
- Rate limiting: 5000/min per IP on ingestion, 10000/min global
- Joi validation: all inputs validated before any DB interaction
- Parameterized queries: SQL injection impossible
- CORS origin whitelist
- TTL index on MongoDB for data retention compliance

---

## 7. What Would Be Added in Production

1. **Distributed Debounce**: Move debounce state to Redis so multiple backend instances share the same window
2. **Auth**: JWT + role-based access (SRE vs Dev vs Manager views)
3. **Timeseries aggregations**: InfluxDB or TimescaleDB for signal rate trends
4. **Alerting delivery**: Actually call PagerDuty/Slack APIs from the strategy classes
5. **Dead letter queue**: Signals that fail 3 drain retries go to a DLQ for manual review
6. **Load balancer**: Nginx upstream for multiple backend instances
7. **Kubernetes**: Replace Docker Compose with Helm chart for production scale
