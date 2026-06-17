# Phase 1 — Ship Blockers

**Effort:** ~2 hours  
**Goal:** Fix everything that would prevent a production deploy.

## Tasks

### 1. Rate Limiting 🔴

**File:** `src/index.ts` (new middleware or inline)

- Per-IP sliding window, configured via `RATE_LIMIT_REQUESTS_PER_MIN` (default 10).
- In-memory `Map<ip, {count, resetAt}>`. Clean up stale entries every 60s.
- Return `429 Too Many Requests` with:
  - `Retry-After` header (seconds until reset)
  - Structured body: `{ success: false, error: { type: "rate_limit", message: "..." } }`
- Exempt `/health` and `/ready` from rate limits.
- Log rate limit hits at `warn` level with IP and path.

### 2. Max Session Cap 🔴

**File:** `src/service/session-manager.ts`

- New env var: `MAX_SESSIONS` (default 20).
- Add check at top of `createSession()`: if `sessions.size >= maxSessions`, throw a typed error.
- Catch in `src/index.ts` handler → return `{ success: false, error: { type: "resource_limit", message: "Maximum active sessions reached" } }`.
- Prevents a single client from spinning up sessions until OOM.

### 3. Global Error Handler

**File:** `src/index.ts`

- Add `.onError(({ code, error, set }) => { ... })` hook on the Elysia app.
- Map known error types to structured responses with appropriate HTTP status codes:
  - `validation` → 400
  - `resource_limit` → 413
  - `timeout` → 504
  - `system` → 500
- For unknown errors in production: log full stack at `error` level, return generic `{ type: "system", message: "Internal server error" }`.
- In dev mode: include the error message (but never raw stacks in prod).

### 4. Readiness Endpoint (`GET /ready`)

**File:** `src/index.ts`

- `/health` stays as liveness — just returns 200 if the process is alive.
- `/ready` is readiness — verify the server can actually execute code:
  - Try spawning a short-lived Worker that runs `1 + 1` via Pyodide.
  - If successful → 200 `{ status: "ready" }`.
  - If Pyodide is still loading or unavailable → 503 `{ status: "not_ready" }`.
- This is what Docker HEALTHCHECK and k8s readinessProbe should hit.

### 5. Dockerfile Fixes

**File:** `Dockerfile`
**New file:** `.dockerignore`

- `.dockerignore`: exclude `node_modules`, `.git`, `logs`, `.env`, `PLAN/`, `.pi/`.
- Update base image from `oven/bun:1.1-slim` to current stable (e.g. `oven/bun:1.2-slim`).
- Restore `COPY bun.lock ./` so installs are reproducible.
- Add HEALTHCHECK:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:3080/ready || exit 1
  ```

### Verifying

```bash
# Rate limiting
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3080/exec?sessionId=test" -H "Content-Type: application/json" -d '{"code":"print(1)"}'; done
# → first 10 are 200, 11th+ are 429

# Session cap
# → after MAX_SESSIONS, new sessions get 413

# Readiness
curl http://localhost:3080/ready   # → {"status":"ready"} after Pyodide loads

# Docker
docker build -t vivarium .
docker run -d -p 3080:3080 vivarium
# → HEALTHCHECK passes after startup
```
