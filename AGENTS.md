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

## ✅ DONE — 3. Execution Timeout ⏱️
Implemented: each session runs in a dedicated Bun `Worker` so timeouts are enforced via OS-level process termination.
- `pyodide.setInterruptBuffer()` + `Uint8Array` does **not** stop CPU-bound infinite loops in Bun + Pyodide 0.29, so the previous approach was replaced entirely.
- Each `PyodidePythonEnvironment` spawns a Worker that owns its Pyodide instance.
- `runCode` posts `{ type: "runCode", code, files }` and races against `config.executionTimeoutMs`.
- On timeout: `worker.terminate()` hard-kills the process (~3s), then a fresh worker is respawned so the session remains usable.
- On unexpected worker error: same kill + respawn path.
- Pre-execution validation (file count, file size, missing fields) still happens in the main thread for fast fail.

Benefits:
- Hard timeouts actually work (verified with `while True: pass`)
- Sessions are truly isolated (separate event loops)
- CPU-heavy code doesn't block the main server thread
- Cleaner session teardown

Files: `src/service/python-worker.ts` (new), `src/service/python-interpreter.ts` (major refactor)

---

## ✅ DONE — 4. Structured Logging 📊 CRITICAL
Implemented: `logixlysia` for HTTP access logs + shared `pino` instance for application logs.
- Single `logixlysia` instance configured with `pino` backend in `src/logger.ts`
- All `console.log` / `console.error` / `console.warn` removed from `src/`
- Log levels: `fatal`, `error`, `warn`, `info`, `debug` (controlled by `LOG_LEVEL`)
- Request context: every `/exec` request binds `sessionId` + `requestId` to a child logger
- Custom `x-request-id` header supported (auto-generated if missing, returned in response headers)
- Execution metrics logged: `runtimeMs`, `fileCount`, `codeLength`, `sessionAgeMs`
- Sensitive field redaction: `b64_data`, `token`, `password`, `apiKey` are stripped globally
- Production mode (`NODE_ENV_PRODUCTION=true`): writes NDJSON to `LOG_FILE_PATH` **and** stdout
- Dev mode: stdout JSON logs + colored HTTP access logs + startup banner
- `messageKey: "msg"` workaround for `logixlysia` bug that outputs `undefined` key
- Graceful shutdown emits structured logs with `signal` context; timeout emits `fatal` level log

Verified via smoke test:
- Startup, session create/acquire/remove, execution lifecycle, resource-limit warnings, timeout, and shutdown all produce proper structured JSON
- Custom `x-request-id` propagates correctly through request → handler → interpreter → log file
- No sensitive data (`b64_data`) leaks into logs

Files: `src/logger.ts` (new), `src/index.ts`, `src/service/session-manager.ts`, `src/service/python-interpreter.ts`, `.env.example`

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
