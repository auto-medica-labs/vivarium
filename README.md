# Vivarium

Vivarium is a Bun/Elysia HTTP service for running Python in isolated Pyodide WebAssembly workers. Client-chosen sessions preserve Python state and files between executions.

> **Security:** Vivarium has no authentication. Anyone who can reach the port can execute arbitrary Python. Deploy behind a VPN, firewall, or authenticated reverse proxy.

## Quick start

Requires [Bun](https://bun.sh/).

```bash
bun install
bun run src/index.ts
```

The server listens on `http://localhost:3080` by default. Use `bun run dev` for watch mode.

```bash
curl http://localhost:3080/ready
curl -X POST 'http://localhost:3080/exec?sessionId=demo' \
  -H 'Content-Type: application/json' \
  -d '{"code":"print(2 + 2)"}'
```

The worker needs `default_python_home/` and a writable `pyodide_cache/`. The Dockerfile preloads the NumPy, Matplotlib, and pandas package cache during the image build.

## API

- `POST /exec?sessionId=<id>` — execute Python; accepts optional base64 files.
- `GET /ready` — lightweight HTTP readiness probe.
- `GET /health` — health and cache/session status.
- `GET /sessions` — active session metadata.
- `GET /metrics` — Prometheus-compatible metrics.

See [the API guide](wiki/architecture/api.md) for payloads, limits, and errors.

## Otari adapter

Vivarium can act as an [Otari](https://docs.otari.ai/) code-execution backend for
Python. The adapter is mounted at `/otari` (configurable with
`OTARI_ROUTE_PREFIX`) and runs alongside the native `/exec` API. Point Otari's
`OTARI_SANDBOX_URL` at the Vivarium URL ending in that prefix.

- `POST /otari/sessions` — lease a session; IDs are server generated, and idle
  and lifetime hints are clamped to `OTARI_MAX_IDLE_TIMEOUT_SECONDS` and
  `OTARI_MAX_LIFETIME_SECONDS`.
- `POST /otari/sessions/{session_id}/exec` — run `code_execution` in the
  session; interpreter state persists across calls.
- `DELETE /otari/sessions/{session_id}` — release a session (idempotent).
- `GET /otari/sessions/{session_id}/files/list`,
  `GET /otari/sessions/{session_id}/files?path=...`, and multipart
  `POST /otari/sessions/{session_id}/files` — list, download, and upload
  workspace files.

```bash
curl -X POST http://localhost:3080/otari/sessions \
  -H 'Content-Type: application/json' \
  -d '{"idle_timeout_seconds":300,"max_lifetime_seconds":900}'

curl -X POST http://localhost:3080/otari/sessions/<session_id>/exec \
  -H 'Content-Type: application/json' \
  -d '{"tool":"code_execution","input":{"code":"print(2 + 2)"}}'
```

Only `code_execution` is supported: `bash_code_execution` and
`text_editor_code_execution` return `400`, so this is Python-only compatibility
rather than full protocol conformance. A Python exception is still a successful
operation (`200` with a non-zero `return_code` and diagnostics in `stderr`);
failures that prevent execution from completing, including timeouts, return
`503` with `{ "detail": "..." }`. Workspace paths are confined to `/home/earth`;
absolute paths, `..`, control bytes, and symlink traversal are rejected, and
uploads respect `MAX_FILE_SIZE_BYTES`. Sessions expire on their idle timeout or
maximum lifetime, and execute never creates a session.

The adapter shares the global rate limiter and has no authentication of its own.
Keep it on a private network or behind an authenticated proxy. See the
[API guide](wiki/architecture/api.md#otari-protocol-adapter) and
[operations](wiki/operations.md#otari-code-execution-adapter) for details.

## Development

```bash
bun run typecheck
bun test
```

Real Pyodide integration tests are slow. See [development and testing](wiki/development/testing.md).

## Documentation

Start with [Wiki quickstart](wiki/quickstart.md), then see:

- [Runtime architecture](wiki/architecture/runtime.md)
- [Operations](wiki/operations.md)
- [Development and testing](wiki/development/testing.md)

## Deployment

Build locally:

```bash
docker build -t vivarium .
docker run --rm -p 3080:3080 vivarium
```

Every push to `main` and every `v*.*.*` tag publishes an image to GHCR through
[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml):

```bash
docker pull ghcr.io/auto-medica-labs/vivarium:latest
docker run --rm -p 3080:3080 ghcr.io/auto-medica-labs/vivarium:latest
```

Configure the service with environment variables documented in [`.env.example`](.env.example) and [operations](wiki/operations.md). Protect the deployment at the network or proxy layer, and configure `TRUSTED_PROXY_COUNT` only for known proxy hops.

## License

MIT. See [LICENSE](LICENSE).
