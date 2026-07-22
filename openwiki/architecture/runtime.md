# Runtime architecture

## Shape

`src/index.ts` is the production entrypoint. It builds the Elysia app through `buildApp()` in `src/app.ts`, starts listening, and handles `SIGTERM`/`SIGINT` by stopping new connections, stopping the rate limiter, shutting down all sessions, and enforcing a 30-second shutdown deadline.

`buildApp()` returns the app plus its `RateLimiter` and `SessionManager`. Returning these dependencies keeps in-process integration tests able to clean up timers and workers.

The Git history records the worker split as a deliberate architectural change: Pyodide moved from the request process into one Bun Worker per session so a runaway execution can be hard-killed without taking down the HTTP server. Later hardening added output/init caps, proxy-aware rate limiting, structured observability, and prototype-chain protections; those controls are part of the current runtime contract.

## Request flow

1. Elysia receives a request. Middleware assigns or preserves `x-request-id`.
1. `/health`, `/ready`, and `/metrics` bypass rate limiting. Other paths are keyed by the direct connection IP unless `TRUSTED_PROXY_COUNT` enables trusted `X-Forwarded-For` processing.
1. `/exec` increments the execution metric, validates the JSON body/query schema, checks filenames and upload sizes, then gets or creates the requested session.
1. The session's `PythonEnvironment.runCode()` sends code and files to its worker. The handler returns the execution result or the structured application error.
1. The worker client serializes executions for that session with `runLock`; a session has one worker and therefore cannot safely execute two snippets concurrently.

## Session lifecycle

`SessionManager` stores sessions in a `Map` keyed by the client-provided ID. A new session:

- checks `MAX_SESSIONS`;
- waits for the `MAX_CONCURRENT_INITS` semaphore slot;
- creates a `PyodidePythonEnvironment` and awaits worker initialization;
- records `createdAt` and `lastAccessedAt` only after initialization succeeds.

Accessing an existing session refreshes `lastAccessedAt`. A cleanup interval checks every minute and terminates sessions idle for `SESSION_TIMEOUT_MINUTES`. `shutdown()` stops that interval and terminates every worker.

## Worker protocol and execution

`python-interpreter.ts` creates a Bun `Worker` for `python-worker.ts`. Messages carry an incrementing `id` and a `type` (`init` or `runCode`); the client resolves only the matching response. The worker owns the Pyodide instance, its `/home/earth` MEMFS filesystem, stdout/stderr buffers, and default files.

Initialization in `python-worker.ts` reads files from `default_python_home`, loads Pyodide using `pyodide_cache`, preloads `numpy`, `matplotlib`, and `pandas`, and imports them. User uploads are written into `/home/earth` before `runPythonAsync()` runs. The worker recursively returns files created there, excluding default files and files supplied in the same request, subject to output count and byte caps.

A run is raced against `EXECUTION_TIMEOUT_MS`. On timeout the client terminates the worker, records a respawn, starts a fresh initialized worker, and throws an HTTP `timeout` `AppError`; the session ID remains reusable but Python state from the killed worker is lost. Unexpected worker errors follow the same terminate/respawn path and become `system` errors.

Python exceptions are caught inside the worker and returned as execution results, including stdout, stderr, runtime, and an error type/message. They are not transport failures, so the API can return HTTP 200 with `success: false`.

## Module map

| Area                  | Source                                | Responsibility                                                    |
| --------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| HTTP composition      | `src/app.ts`                          | Elysia routes, validation, rate limiting, errors, request logging |
| Configuration         | `src/config/index.ts`, `src/utils.ts` | Environment parsing and non-zero resource constraints             |
| Session lifecycle     | `src/service/session-manager.ts`      | Session map, init semaphore, idle cleanup, shutdown               |
| Worker client         | `src/service/python-interpreter.ts`   | Worker messages, per-session lock, timeout recovery               |
| Python runtime        | `src/service/python-worker.ts`        | Pyodide, virtual filesystem, packages, sandbox controls           |
| Cross-layer contracts | `src/service/types.ts`                | `PythonEnvironment` and execution response shapes                 |
