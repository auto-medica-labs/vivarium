# Operations

## Configuration

Configuration is read when `src/config/index.ts` is imported. Integer values must be non-negative; execution, upload, session, output, and initialization caps explicitly reject zero. Set environment variables before starting the process.

| Variable                         |          Default | Purpose                                                    |
| -------------------------------- | ---------------: | ---------------------------------------------------------- |
| `PORT`                           |           `3080` | HTTP listen port                                           |
| `SESSION_TIMEOUT_MINUTES`        |             `10` | Idle session lifetime                                      |
| `EXECUTION_TIMEOUT_MS`           |          `60000` | Hard per-execution timeout                                 |
| `MAX_FILE_SIZE_BYTES`            |       `10485760` | Maximum decoded size of one input file                     |
| `MAX_FILES_PER_REQUEST`          |             `10` | Input file count cap                                       |
| `RATE_LIMIT_REQUESTS_PER_MIN`    |             `10` | Per-IP request limit in a fixed one-minute window          |
| `MAX_SESSIONS`                   |             `20` | Active session cap                                         |
| `MAX_CONCURRENT_INITS`           |              `2` | Concurrent Pyodide initialization slots                    |
| `MAX_OUTPUT_FILES`               |            `100` | Returned output-file count cap                             |
| `MAX_OUTPUT_BYTE_SIZE`           |       `10485760` | Total returned output bytes cap                            |
| `OTARI_ROUTE_PREFIX`             |         `/otari` | Prefix for the Otari code-execution adapter                |
| `OTARI_MAX_IDLE_TIMEOUT_SECONDS` |            `600` | Maximum idle lease accepted by the adapter                 |
| `OTARI_MAX_LIFETIME_SECONDS`     |           `3600` | Maximum lifetime accepted by the adapter                   |
| `OTARI_CLEANUP_INTERVAL_MS`      |           `1000` | Adapter lease cleanup cadence (must be at most one second) |
| `TRUSTED_PROXY_COUNT`            |              `0` | Number of trusted proxies for client-IP extraction         |
| `LOG_LEVEL`                      |           `info` | Pino log level                                             |
| `LOG_FILE_PATH`                  | `./logs/app.log` | Production log destination                                 |
| `NODE_ENV_PRODUCTION`            |          `false` | Adds NDJSON file logging and hides internal error messages |

`.env.example` is the canonical list. The checked-in README has an older timeout example; use the config source and `.env.example` above.

## Otari code-execution adapter

Vivarium implements Otari code-execution protocol v1 for Python `code_execution` and session workspace files. Configure Otari's `OTARI_SANDBOX_URL` to the Vivarium base URL ending in the configured `OTARI_ROUTE_PREFIX` (default `/otari`). The adapter ignores the requested image, generates session IDs, and clamps idle and lifetime hints to the configured ceilings. It rejects Bash and text-editor tool kinds with protocol-shaped `400` errors.

Adapter execution failures that prevent a run from completing, including worker timeouts, return `503` with `{ "detail": "..." }`; Python exceptions remain `200` result blocks with a non-zero `return_code`. The adapter shares the existing request rate limiter and has no built-in authentication. Keep it on a private network reachable by Otari or place it behind an authenticated, tenancy-aware front door.

The Otari v0.56.1 conformance checker passes session lifecycle, Python execution, and file operations. Its Bash and text-editor execution checks fail because those tool kinds are intentionally unsupported, so this backend is Python-only compatibility rather than full protocol v1 conformance.

## Docker deployment

`Dockerfile` uses `oven/bun:1.2-slim`, installs only production dependencies from `package.json` and `bun.lock`, copies `src/` and `default_python_home/`, preloads NumPy, Matplotlib, and pandas into a writable `pyodide_cache/`, exposes port 3080, and runs as the non-root `bun` user. Its Docker `HEALTHCHECK` calls `/ready` every 30 seconds with a 10-second timeout.

Pushes to `main` and `v*.*.*` tags publish `ghcr.io/auto-medica-labs/vivarium` via `.github/workflows/docker-publish.yml`. The workflow authenticates with the repository `GITHUB_TOKEN` and needs `packages: write` permission.

The application has no built-in auth. Do not publish the port directly to the internet. Use a private network/VPN or an authenticated reverse proxy with TLS. If a proxy is used, set `TRUSTED_PROXY_COUNT` to the number of trusted hops so rate limiting sees the client IP; leaving it at `0` intentionally ignores spoofable `X-Forwarded-For`.

## Probes and lifecycle

- Use `/ready` for a cheap HTTP responsiveness probe; it intentionally does not validate Pyodide startup.
- Use `/health` to inspect session-manager state and cache readability without spawning a worker.
- Use `/sessions` and `/metrics` for operational visibility, remembering they are unauthenticated unless protected by the deployment.
- On `SIGTERM`/`SIGINT`, startup code stops the rate limiter, stops the Elysia server, terminates sessions, and exits after successful cleanup. A 30-second timer forces a non-zero exit if shutdown hangs.

## Logs and metrics

`src/logger.ts` configures Pino through `logixlysia`. Logs go to stdout; production mode also writes to `LOG_FILE_PATH`. Fields `password`, `token`, `apiKey`, and `b64_data` are redacted/removed. `/exec` logs child context including session and request IDs, but never log file payloads.

`/metrics` exposes:

- request counters by `success`, `error`, `timeout`, and `rate_limited`;
- execution count and worker respawns;
- active sessions and current Node heap usage;
- execution, worker-init, and full-request duration histograms.

The metrics object is a process singleton, so counters reset on restart and are not shared across replicas.

## Sandbox boundary

Pyodide runs inside a dedicated Bun Worker with an in-memory filesystem. The worker exposes only a small DOM/timer stub to support matplotlib initialization. After package preload it removes `NODEFS`, `WORKERFS`, and `PROXYFS`, and disables package/module registration APIs. Exposed objects and host functions use null prototypes to block prototype-chain access; integration tests cover the CVE-2026-5752 regression.

The runtime is intended to provide no network, shell, subprocess, host-filesystem, or runtime package-install capability. Treat this as a security boundary that still requires defense-in-depth deployment controls: resource settings, proxy authentication, restricted network exposure, and monitoring.
