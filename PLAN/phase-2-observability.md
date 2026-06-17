# Phase 2 — Observability & Hardening

**Effort:** ~1.5 hours  
**Goal:** Metrics for operations + hardening edge cases.

## Tasks

### 1. Prometheus Metrics Endpoint (`GET /metrics`)

**File:** `src/index.ts`

- No new dependency — plain text format is trivial.
- Counters:
  - `vivarium_requests_total{status="success|error|timeout|rate_limited"}` — incremented by middleware/error handler.
  - `vivarium_executions_total` — total `/exec` calls.
- Gauges:
  - `vivarium_active_sessions` — `sessionManager.getActiveSessionCount()`.
  - `vivarium_memory_usage_bytes` — `process.memoryUsage().heapUsed`.
- Histogram:
  - `vivarium_execution_duration_ms` — bucket `[10, 50, 100, 500, 1000, 5000, 30000, 60000]`.
- Expose at `GET /metrics` with `Content-Type: text/plain`.

### 2. CORS Middleware (conditional)

**File:** `src/index.ts`

- If this service is called from browsers, add CORS headers (`Access-Control-Allow-Origin`, etc.).
- If it's always server-to-server (curl, Python, backend services), skip this entirely.
- **Decision needed** — ask before implementing.

### 3. Per-Session Execution Lock

**File:** `src/service/python-interpreter.ts` (or `session-manager.ts`)

- Problem: Two concurrent requests to the same session both call `runCode()`. If request A times out and kills the worker, request B's message was already sent to the dead worker. B eventually times out too, even though the code would have run fine sequentially.
- Fix: Store a `Promise` chain on the session (or environment). Each `runCode` call queues behind the previous one for that session.
- ~5 lines:
  ```typescript
  // in runCode, before sending to worker:
  this._lock = (this._lock || Promise.resolve()).then(() => actualRun(), () => actualRun());
  return this._lock;
  ```
- This serializes execution per session (worker processes one at a time anyway — this just prevents the race).

### Verifying

```bash
# Metrics
curl http://localhost:3080/metrics

# Concurrent execution lock
# Fire two requests to same session simultaneously, with one guaranteed to timeout.
# Neither should get a bogus timeout from the other's worker death.
```
