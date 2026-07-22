# Development and testing

## Commands

```bash
bun install
bun run dev          # watch mode
bun run src/index.ts # production-style local start
bun run typecheck
bun test             # package script: Bun test, 30 s default timeout
```

The GitHub Actions workflow at `.github/workflows/test.yml` runs on every push using Ubuntu, Bun `1.2.10`, `bun install`, and `bun run test`.

## Test layers

- `src/__tests__/config.test.ts` tests environment integer/string/boolean parsing and validation helpers in isolation.
- `src/__tests__/rate-limiter.test.ts` tests fixed-window counters, independent IPs, reset, cleanup stopping, and zero limits.
- `src/__tests__/session-manager.test.ts` injects mock environments to test creation, reuse, cap enforcement, expiration, metadata, termination, and shutdown without Pyodide startup.
- `src/__tests__/integration.test.ts` drives `buildApp().app.handle()` in-process against real workers. It covers execution, expressions, session expiry, files, limits, timeout recovery, rate limiting, validation, Python errors, sandbox hardening, disabled package installation, filesystem backends, and matplotlib.

The test preload sets integration environment variables before any test module imports `src/config`, because configuration is evaluated at module import time. Each test builds a fresh app and must shut down both the returned `sessionManager` and `rateLimiter`; real Pyodide initialization makes the suite substantially slower than unit tests.

## Change guide

- Route/schema, status, request-ID, or rate-limit behavior → update `src/app.ts` and integration tests.
- Configuration or a new operational limit → update `src/config/index.ts`, `.env.example`, and config tests; prefer passing `config` through existing services rather than hard-coding.
- Session policy → update `src/service/session-manager.ts` and its injected-environment tests.
- Worker protocol, Python filesystem/output behavior, or sandbox exposure → update both sides of the protocol (`python-interpreter.ts` and `python-worker.ts`) and add/extend integration coverage, especially security tests.
- Metrics/log fields → update `src/metrics.ts` or `src/logger.ts` and verify `/metrics` or request behavior through the app.

## Extension seams

`PythonEnvironment` in `src/service/types.ts` is the abstraction used by `SessionManager`. Its `EnvironmentFactory` constructor argument is the intended seam for fast tests or an alternative environment. `buildApp()` is the app factory for in-process callers. The worker message `type`/`id` protocol is the narrow boundary between HTTP/session code and Pyodide.

Keep worker termination and timer cleanup paths intact. A worker can retain session state, while a timeout deliberately destroys that state to guarantee a hard stop; adding interrupt logic in the main thread is not a substitute for termination.
