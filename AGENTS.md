Production Readiness Improvement Plan

## ✅ DONE — 1. Configuration Management ⚙️
Implemented: centralized `src/config/index.ts` with env var validation and defaults.
- `PORT`, `SESSION_TIMEOUT_MINUTES`, `EXECUTION_TIMEOUT_MS`, `MAX_FILE_SIZE_BYTES`
- `MAX_FILES_PER_REQUEST`, `RATE_LIMIT_REQUESTS_PER_MIN`, `LOG_LEVEL`
- Throws on startup if constraints are violated (e.g. timeout = 0)
Files: `src/config/index.ts` (new), `.env.example` (new), `src/index.ts`, `src/service/python-interpreter.ts`

## ✅ DONE — 2. Resource Limits (File Count / File Size) 📦
Implemented: guards before code execution.
- Rejects requests with files > `MAX_FILES_PER_REQUEST` (default 10)
- Rejects individual files > `MAX_FILE_SIZE_BYTES` (default 10MB)
- Returns `{ success: false, error: { type: "resource_limit", message: ... } }`
Files: `src/index.ts`, `src/service/python-interpreter.ts`

## ❌ BROKEN — 3. Execution Timeout ⏱️
**Problem:** `pyodide.setInterruptBuffer()` + `Uint8Array` does **not** stop CPU-bound
infinite loops in Bun + Pyodide 0.29. A `while True: pass` hangs the main thread
indefinitely; the 30s timeout never fires and the server becomes unresponsive.

**Verified behavior:**
- `setTimeout(() => interrupt[0] = 1, 30000)` is queued but Pyodide never yields
  to the event loop in a tight loop, so the callback never runs.
- Same behavior with `runPythonAsync` and `runPython`.
- Calling `worker.terminate()` on a Bun Worker **does** kill the Pyodide process
  instantly (~3s). Tested and confirmed working.

**Proposed Fix:** Refactor `PyodidePythonEnvironment` to run inside a Bun Worker.
- Each session spawns a Worker that owns its Pyodide instance.
- `runCode` posts a message to the worker and awaits a response.
- A `Promise.race` with a `setTimeout` rejects on timeout.
- On timeout, call `worker.terminate()` and spawn a replacement worker.
- On session cleanup, terminate the worker.

Benefits:
- Hard timeouts actually work (OS-level process termination)
- Sessions are truly isolated (separate event loops)
- CPU-heavy code doesn't block the main server thread
- Cleaner session teardown (no leaked Pyodide heaps in main process)

Trade-offs:
- Slightly higher memory per session (worker overhead)
- Message-passing overhead for file I/O (must serialize FS ops)

Files to change: `src/service/python-interpreter.ts` (major refactor),
`src/service/session-manager.ts` (adapt to worker lifecycle)

---

## 4. Structured Logging 📊 CRITICAL
Problem: console.log statements are not production-ready (no levels, timestamps, context).
Fixes:
- Add a logging library (e.g. pino or winston)
- Replace all console.log with structured logger
- Log levels: error, warn, info, debug
- Add request context (sessionId, requestId) to all logs
- Log execution metrics (duration, memory usage per session)
Files: src/index.ts, src/service/session-manager.ts, src/service/python-interpreter.ts

## 5. Rate Limiting 🛡️ CRITICAL
Problem: No protection against abuse/DDoS.
Fixes:
- Add rate limiting middleware (e.g. elysia-rate-limit)
- Limit requests per IP/session (e.g. 10 req/min)
- Separate limits for /exec endpoint (more restrictive)
- Include rate limit headers in responses
Files: src/index.ts

## 6. Enhanced Error Handling ❌ CRITICAL
Problem: Limited error context, no error tracking.
Fixes:
- Wrap all async operations with proper try/catch
- Add global error handler middleware
- Categorize errors (validation, execution, system, timeout)
- Add error codes and retry guidance
- Log full error stack traces with context
Files: src/index.ts, src/service/python-interpreter.ts

## 7. Enhanced Health Monitoring 💓 CRITICAL
Problem: Basic health check doesn't verify system functionality.
Fixes:
- Add liveness endpoint (GET /health) - check if server is running
- Add readiness endpoint (GET /ready) - check if server can accept requests
- Verify Pyodide is loaded in readiness check
- Monitor memory usage and active session count
- Return degraded status if approaching resource limits
Files: src/index.ts

## 8. Process Monitoring 🔍 IMPORTANT
Problem: No visibility into server health during runtime.
Fixes:
- Add Prometheus-style metrics endpoint (GET /metrics)
- Track: active sessions, execution count, success/error rates, avg execution time
- Expose memory usage, CPU usage
- Use a simple metrics library (e.g. prom-client)
Files: src/index.ts, src/service/session-manager.ts
