# Incident Management System (IMS)

**Assignment submission for: Infrastructure / SRE Intern — Zeotap**
**Candidate:** Dhanush M
**GitHub:** https://github.com/dhanushmaranii2604/ims

---

## Architecture Diagram

```
                         ┌─────────────────────────────────────────────────────┐
                         │                    CLIENTS                          │
                         │   React Dashboard     Simulation Script    curl     │
                         └──────────────┬──────────────┬───────────────────────┘
                                        │ HTTP/WS       │ POST /api/signals
                         ┌──────────────▼──────────────▼───────────────────────┐
                         │                BACKEND (Node.js / Express)           │
                         │                                                      │
                         │  ┌─────────────┐   ┌──────────────┐                 │
                         │  │ Rate Limiter│   │  /health     │                 │
                         │  │  5000/min   │   │  /metrics    │                 │
                         │  └──────┬──────┘   └──────────────┘                 │
                         │         │                                            │
                         │  ┌──────▼──────────────────────────────────┐        │
                         │  │           INGESTION PIPELINE             │        │
                         │  │                                          │        │
                         │  │  Validate → RingBuffer (50k cap) → Drain│        │
                         │  │              ↓ async                     │        │
                         │  │         DebounceEngine                   │        │
                         │  │  (100 signals/10s → 1 Work Item)         │        │
                         │  └──────────────────────────────────────────┘        │
                         │         │                                            │
                         │  ┌──────▼──────────────────────────────────┐        │
                         │  │         WORKFLOW ENGINE                  │        │
                         │  │                                          │        │
                         │  │  AlertStrategy (Strategy Pattern)        │        │
                         │  │  RDBMS→P0, MCP→P0, QUEUE→P1, CACHE→P2  │        │
                         │  │                                          │        │
                         │  │  WorkItemState (State Pattern)           │        │
                         │  │  OPEN→INVESTIGATING→RESOLVED→CLOSED      │        │
                         │  │  (CLOSED requires complete RCA)          │        │
                         │  └──────────────────────────────────────────┘        │
                         │         │                    │                       │
                         └─────────┼────────────────────┼───────────────────────┘
                                   │                    │
              ┌────────────────────┼────────────────────┼─────────────────────┐
              │                   │                    │                      │
   ┌──────────▼──────┐  ┌─────────▼──────┐  ┌─────────▼──────┐  ┌──────────┐│
   │   MongoDB        │  │  PostgreSQL    │  │    Redis        │  │ WebSocket ││
   │  (Data Lake)     │  │ (Source of    │  │   (Hot Cache)   │  │  /ws      ││
   │                  │  │    Truth)     │  │                 │  │  Live push ││
   │  Raw signals     │  │  work_items   │  │  dashboard:     │  └──────────┘│
   │  (audit log)     │  │  rca_records  │  │  workitems      │              │
   │  TTL: 30 days    │  │  ACID txns    │  │  workitem:{id}  │              │
   └──────────────────┘  └───────────────┘  │  metrics:latest │              │
                                             └─────────────────┘              │
              └──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend Runtime | Node.js 20 (async/await) | Native async, non-blocking I/O |
| HTTP Framework | Express 4 | Battle-tested, fast routing |
| Data Lake | MongoDB 7 | Flexible schema for raw signals, TTL index |
| Source of Truth | PostgreSQL 16 | ACID transactions for Work Items + RCA |
| Cache / Hot-path | Redis 7 | Sub-ms reads for dashboard state |
| Real-time Push | WebSocket (ws) | Push work item updates to browser |
| Validation | Joi | Schema validation on all inputs |
| Security | Helmet + Rate Limiting | OWASP headers + DDoS protection |
| Frontend | React 18 | Component-driven live dashboard |
| Containerization | Docker + Docker Compose | One-command full-stack startup |

---

## Design Patterns Used

### 1. Strategy Pattern — `AlertStrategy.js`
Different component failures require different priority levels and notification channels. Instead of a giant `if/else` block, each component type maps to a concrete strategy class:

```
RDBMS  → RDBMSAlertStrategy  → P0, channels: [pagerduty, slack, sms]
MCP    → MCPAlertStrategy    → P0, channels: [pagerduty, slack]
QUEUE  → QueueAlertStrategy  → P1, channels: [pagerduty, slack]
API    → APIAlertStrategy    → P1, channels: [slack, email]
CACHE  → CacheAlertStrategy  → P2, channels: [slack]
NOSQL  → NoSQLAlertStrategy  → P3, channels: [slack]
```

Adding a new component type = add 1 class + 1 line in the registry. Zero changes to calling code.

### 2. State Pattern — `WorkItemState.js`
Each state encapsulates its own valid transitions. Invalid transitions throw immediately:

```
OPEN          → can go to: INVESTIGATING
INVESTIGATING → can go to: RESOLVED, OPEN
RESOLVED      → can go to: CLOSED (only with complete RCA), INVESTIGATING
CLOSED        → cannot go anywhere (terminal state)
```

The `CLOSED` transition validates all 5 required RCA fields before proceeding, throwing `TRANSITION_BLOCKED` errors if anything is missing.

---

## How Backpressure is Handled

The ingestion pipeline uses a **Ring Buffer** (`RingBuffer.js`) with a capacity of 50,000 signals — approximately 5 seconds of full 10,000/s throughput.

**Flow:**
1. Signal arrives at `POST /api/signals`
2. Signal is pushed into the Ring Buffer **immediately** (< 1μs, never blocks)
3. HTTP 202 Accepted returned to caller
4. A separate **async drain loop** runs every 100ms, pulling batches of 500 signals and writing to MongoDB
5. If MongoDB is slow/down: signals stay in the Ring Buffer
6. If the Ring Buffer fills (50k cap): oldest signals are **overwritten** (ring semantics, zero crash risk)
7. Failed drain batches are **re-queued** into the buffer for retry

**Result:** The HTTP layer never blocks on DB writes. Even if MongoDB goes down for 5 seconds, 50,000 signals are safely buffered in process memory, with zero process crashes.

---

## Quick Start

### Prerequisites
- Docker + Docker Compose installed
- Ports 3000, 4000, 5432, 6379, 27017 free

### 1. Clone and start
```bash
git clone https://github.com/dhanushmaranii2604/ims
cd ims
docker-compose up --build
```

### 2. Open the Dashboard
```
http://localhost:3000
```

### 3. Run the failure simulation
```bash
# In a separate terminal (after docker-compose is up)
node scripts/simulate_failure.js
```

This sends ~230 signals across 4 component types, triggering 4 Work Items (RDBMS/MCP/CACHE/QUEUE).

### 4. Check the health endpoint
```bash
curl http://localhost:4000/health
```

### 5. Run unit tests
```bash
cd backend
npm install
npm test
```

---

## API Reference

### Ingest Signal
```
POST /api/signals
Content-Type: application/json

{
  "component_id":   "POSTGRES_PRIMARY_01",
  "component_type": "RDBMS",
  "message":        "Connection timeout",
  "error_code":     "CONN_TIMEOUT",
  "metadata":       {}
}

→ 202 Accepted { "accepted": true, "signal_id": "uuid" }
```

### Batch Ingest (up to 1000)
```
POST /api/signals/batch
Body: array of signal objects
```

### Get All Work Items
```
GET /api/workitems
→ Array sorted by priority (P0 first) then updated_at
```

### Get Work Item Detail + Raw Signals
```
GET /api/workitems/:id
→ { ...workItem, rca: {...} | null, signals: [...] }
```

### Transition Status
```
PATCH /api/workitems/:id/status
{ "status": "INVESTIGATING" }

# To close (requires RCA):
{
  "status": "CLOSED",
  "rca": {
    "incident_start":       "2024-01-01T10:00:00Z",
    "incident_end":         "2024-01-01T11:00:00Z",
    "root_cause_category":  "Infrastructure Failure",
    "fix_applied":          "Restarted primary DB node",
    "prevention_steps":     "Add automated failover"
  }
}
```

### Health Check
```
GET /health
→ { status, uptime, db: {mongo, postgres, redis}, metrics: {signalsPerSec, totalSignals} }
```

---

## MTTR Calculation

When a Work Item is closed, MTTR is automatically calculated:

```
MTTR (seconds) = RCA.incident_end - RCA.incident_start
```

Stored in `rca_records.mttr_seconds`. The dashboard converts this to minutes for display.

---

## Security (Bonus)

- **Helmet.js**: Sets 11 security headers (X-Frame-Options, Content-Security-Policy, etc.)
- **Rate Limiting**: 5000 requests/minute per IP on ingestion endpoint; 10,000/minute global ceiling
- **Input Validation**: Joi validates every signal and RCA payload — no raw user input reaches the DB
- **Parameterized Queries**: All PostgreSQL queries use `$1, $2` placeholders — SQL injection impossible
- **CORS**: Configurable origin whitelist
- **TTL Index**: Raw signals auto-expire from MongoDB after 30 days

---

## Test Coverage

Tests are in `backend/tests/ims.test.js` and cover:

- All valid state transitions (OPEN→INVESTIGATING→RESOLVED→CLOSED)
- All invalid state transitions (throw errors)
- RCA validation: blocks CLOSED if RCA is null, incomplete, or has empty fields
- Alert strategy priority mapping for all 6 component types
- Alert strategy channel assignment
- State hydration from string (DB reload scenarios)

Run: `cd backend && npm test`

---

## Project Structure

```
ims/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js          # MongoDB + PostgreSQL + Redis connections
│   │   │   └── logger.js      # Winston logger
│   │   ├── ingestion/
│   │   │   ├── RingBuffer.js  # Backpressure buffer + async drain loop
│   │   │   └── DebounceEngine.js  # 100 signals/10s → 1 Work Item
│   │   ├── workflow/
│   │   │   ├── AlertStrategy.js   # Strategy Pattern - priority by component type
│   │   │   └── WorkItemState.js   # State Pattern - lifecycle transitions
│   │   ├── models/
│   │   │   └── Signal.js      # MongoDB signal schema
│   │   ├── routes/
│   │   │   ├── signals.js     # POST /api/signals (+ /batch)
│   │   │   ├── workitems.js   # GET/PATCH /api/workitems
│   │   │   └── health.js      # GET /health
│   │   ├── observability/
│   │   │   └── metrics.js     # Throughput metrics, 5s console loop
│   │   └── index.js           # Express app + WebSocket + bootstrap
│   ├── tests/
│   │   └── ims.test.js        # Unit tests (State, RCA, Strategy)
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/client.js      # Axios API client
│   │   ├── hooks/useWebSocket.js  # WS hook with auto-reconnect
│   │   ├── App.jsx            # Full dashboard UI
│   │   ├── App.css            # Dark industrial theme
│   │   └── index.js
│   ├── public/index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── scripts/
│   ├── simulate_failure.js    # Mock RDBMS + MCP failure scenario
│   └── sample_failure_events.json
├── docker-compose.yml
└── README.md
```

---

## Prompts and Planning

See `docs/PROMPTS.md` for all prompts and planning markdowns used during development.
