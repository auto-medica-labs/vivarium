# Vivarium — Agent Context

Vivarium is a sandboxed Python execution server. It exposes an HTTP API that
lets clients run Python code in isolated sessions backed by
[Pyodide](https://pyodide.org/) (Python in WebAssembly) running inside Bun
`Worker`s.

## Stack

- **Runtime:** Bun (TypeScript, ES modules)
- **Web framework:** Elysia.js
- **Python engine:** Pyodide, loaded in a dedicated `Worker` per session
- **Logs:** `pino` via `logixlysia`
- **Tests:** Bun's built-in test runner (`bun:test`)

## Project layout

```
src/
├── app.ts                    # Elysia app factory (buildApp) + routes + middleware
├── config/index.ts           # Environment config with validation and defaults
├── errors.ts                 # AppError types and HTTP status mapping
├── index.ts                  # Server bootstrap, listen, graceful shutdown
├── logger.ts                 # pino / logixlysia setup
├── metrics.ts                # Prometheus-compatible metrics singleton
├── service/
│   ├── python-interpreter.ts # PyodidePythonEnvironment: spawns/communicates with worker
│   ├── python-worker.ts      # Bun Worker that owns one Pyodide instance
│   ├── session-manager.ts    # Creates, times out, and tears down sessions
│   └── types.ts              # Shared TS interfaces
└── __tests__/
    └── integration.test.ts   # Full API integration tests
```

## Environment variables

See `.env.example`. Loaded/validated in `src/config/index.ts`:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3080 | HTTP port |
| `SESSION_TIMEOUT_MINUTES` | 10 | Inactivity before a session is cleaned up |
| `EXECUTION_TIMEOUT_MS` | 30000 | Hard kill limit for a single `runCode` |
| `MAX_FILE_SIZE_BYTES` | 10485760 | Per-upload file size limit |
| `MAX_FILES_PER_REQUEST` | 10 | Max files per `/exec` request |
| `RATE_LIMIT_REQUESTS_PER_MIN` | 10 | Per-IP request rate limit |
| `MAX_SESSIONS` | 20 | Active session cap |
| `LOG_LEVEL` | info | pino log level |
| `LOG_FILE_PATH` | ./logs/app.log | Production log destination |
| `NODE_ENV_PRODUCTION` | false | Enables NDJSON file logging |

Config throws on startup if a constraint is violated (e.g. timeout = 0).

## API

### `POST /exec?sessionId=<id>`

Body:

```json
{
  "code": "print('hello')",
  "files": [
    { "filename": "data.csv", "b64_data": "aGVsbG8=" }
  ]
}
```

Success:

```json
{
  "success": true,
  "result": {
    "final_expression": "...",
    "output_files": [],
    "std_out": "hello\n",
    "std_err": "",
    "code_runtime": 123
  }
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "type": "resource_limit",
    "message": "..."
  }
}
```

### Other endpoints

- `GET /health` — basic health + active session count
- `GET /ready` — lightweight readiness probe; returns 200 when the HTTP server is responsive (does not spawn Pyodide)
- `GET /sessions` — list active sessions with age/idle metadata
- `GET /metrics` — Prometheus text metrics

## Error types

Handled in `src/errors.ts` and `src/app.ts` `onError`:

| Type | HTTP | When |
|---|---|---|
| `validation` | 400 | Invalid/missing params |
| `resource_limit` | 413 | File count/size, session cap, rate limit |
| `timeout` | 504 | `EXECUTION_TIMEOUT_MS` exceeded |
| `execution` | 200* | Python execution errors (e.g. `NameError`) |
| `system` | 500 | Unexpected server errors |

\* Python errors return HTTP 200 from the handler because the interpreter ran
successfully; the `success` flag is false.

## Architecture notes

### One Worker per session

`PyodidePythonEnvironment` spawns a Bun `Worker` (`src/service/python-worker.ts`)
that owns a single Pyodide instance. Messages are `{ id, type, ... }` and the
main thread waits for a matching response id. This gives true isolation and
allows hard timeouts via `worker.terminate()`.

### Execution timeout

`python-interpreter.ts` races the worker response against
`config.executionTimeoutMs`. On timeout it kills the worker, respawns a fresh
one, and throws `AppError("timeout")`. The session remains usable afterwards.

### Per-session run lock

`runCode` in `python-interpreter.ts` serializes calls through `this.runLock` so
only one execution per session runs at a time. This avoids re-entrancy issues
with the single worker.

### Session lifecycle

`SessionManager` keeps a map of sessions and runs a cleanup interval. Sessions
expire after `SESSION_TIMEOUT_MINUTES` of inactivity. `shutdown()` terminates all
workers and stops the cleanup interval.

### Logging

- `src/logger.ts` exports a shared `pino` instance.
- Redacts `b64_data`, `token`, `password`, `apiKey` globally.
- Production mode writes NDJSON to `LOG_FILE_PATH` plus stdout.
- Every `/exec` request gets a child logger with `sessionId` and `requestId`.
- `x-request-id` header is honored and returned.

### Metrics

`src/metrics.ts` is a singleton. `/metrics` renders:

- `vivarium_requests_total{status}`
- `vivarium_executions_total`
- `vivarium_active_sessions`
- `vivarium_memory_usage_bytes`
- `vivarium_execution_duration_ms` histogram

## Testing

Run:

```bash
bun test
```

Tests import `buildApp()` from `src/app.ts` so they can drive the app
in-process with `app.handle()`. Each test gets a fresh app instance; `afterEach`
shuts down the session manager and stops the rate limiter.

Important test constraints:

- Pyodide init is slow (~10–12 s per fresh session). The suite takes ~2 minutes.
- Env vars are set at the top of the test file **before** dynamically importing
  `buildApp`, because `src/config/index.ts` reads/validates env at import time.
- The session-cap test has its own 60 s timeout because it creates 3 sessions
  sequentially.

## Agent guidelines

- **Keep lazy.** Prefer env-driven config over new code. Use `config` from
  `src/config/index.ts` instead of hard-coding limits.
- **Avoid adding dependencies.** Bun's test runner, stdlib, and Elysia cover
  almost everything.
- **Sensitive data:** never log `b64_data`, tokens, passwords, or API keys. The
  logger already redacts them.
- **Errors:** throw `AppError(type, message)` from handlers; the global
  `onError` will format the response.
- **Sessions:** if you need to iterate over sessions in tests, use
  `sessionManager.getSessionsInfo()` or export the manager from `buildApp()`.
- **Workers:** do not try to interrupt CPU-bound Python from the main thread.
  Timeouts are enforced by killing and respawning the worker.
