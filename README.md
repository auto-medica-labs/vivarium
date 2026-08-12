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
