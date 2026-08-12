# Vivarium Wiki

Vivarium is a Bun/TypeScript HTTP service that runs user-supplied Python in a dedicated Pyodide WebAssembly worker per session. Sessions preserve Python state and files between executions, while inactivity cleanup and hard execution limits bound resource use.

## Start locally

Prerequisite: [Bun](https://bun.sh/).

```bash
bun install
bun run src/index.ts
```

The server listens on `PORT` (default `3080`). Development watch mode is:

```bash
bun run dev
```

The worker expects the checked-out `default_python_home/` directory and a writable `pyodide_cache/` directory. Docker preloads the NumPy, Matplotlib, and pandas package cache during the image build.

## Try the API

```bash
curl http://localhost:3080/ready
curl -X POST 'http://localhost:3080/exec?sessionId=demo' \
  -H 'Content-Type: application/json' \
  -d '{"code":"print(2 + 2)"}'
```

Use a stable, client-chosen `sessionId` to reuse interpreter state. See [API](architecture/api.md) for request/response contracts and limits.

## Verify changes

```bash
bun run typecheck
bun test
```

Tests use Bun's built-in runner. Full integration tests boot real Pyodide workers and are consequently slow. See [development and testing](development/testing.md).

## Find the right page

- [Runtime architecture](architecture/runtime.md) — request flow, sessions, workers, timeouts, and output collection.
- [HTTP API](architecture/api.md) — endpoints, payloads, response semantics, and errors.
- [Operations](operations.md) — environment configuration, Docker, probes, logging, metrics, and deployment security.
- [Development and testing](development/testing.md) — CI, test seams, and safe extension points.

## Where to start changing code

- Routes and middleware: `src/app.ts`
- Environment validation: `src/config/index.ts`
- Session lifecycle: `src/service/session-manager.ts`
- Main-thread worker client and timeout recovery: `src/service/python-interpreter.ts`
- Pyodide setup, sandbox hardening, and Python execution: `src/service/python-worker.ts`
- Server startup/shutdown: `src/index.ts`
