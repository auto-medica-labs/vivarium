# Vivarium Production Readiness Plan

Status: based on audit of `vivarium` codebase.  
Last updated: 2026-06-18

## Decisions already made

- `/ready` is intentionally a **quick HTTP server check only** and does **not** spawn Pyodide. Documentation has been aligned.

---

## Must fix before production

### 1. Path traversal in file uploads
- Reject `..`, absolute paths, null bytes, and control characters in uploaded `filename` values.
- Verify the final write path is strictly under `/home/earth` before calling `pyodide.FS.writeFile`.

### 2. Cap output file collection
- Limit total number of files returned in `output_files`.
- Limit aggregate byte size of returned files.
- Skip known transient files (already skips `default.profraw`).
- Consider requiring opt-in for file return or returning only explicitly requested outputs.

### 3. Fix TypeScript `moduleResolution` deprecation
- Replace `"moduleResolution": "node"` in `tsconfig.json` with `"Bundler"` or `"NodeNext"`.
- Resolve any import resolution fallout.

### 4. Add a `Dockerfile` and a `start` script
- Add a working `Dockerfile` to the repo (do not rely on README example).
- Add `start` and `typecheck` scripts to `package.json`.

---

## Should fix soon after

### 5. Improve `/health` usefulness
- Verify the session manager is running.
- Optionally verify Pyodide package cache is accessible without booting a full worker.

### 6. Limit concurrent session creation
- Add a semaphore or queue for Pyodide worker initialization.
- Prevents a burst of new sessions from OOM-ing the process (each init is ~8–10 s and memory-heavy).

### 7. Harden the rate limiter
- Add trusted-proxy configuration for `X-Forwarded-For`.
- Document that the in-memory rate limiter is single-instance only and not shared across replicas.

### 8. Expand metrics
- Worker init duration histogram.
- Worker crash / respawn counter.
- `/exec` HTTP request duration histogram.
- Active session memory usage (per session if feasible).

### 9. Align error types
- Add `rate_limit` and `parsing` to `AppError` / `STATUS_BY_TYPE` instead of returning them ad-hoc.

---

## Polish / maintainability

### 10. Remove duplicated `getBase64ByteSize`
- Move the function to a shared utility module.

### 11. Add lint / format / typecheck tooling
- Add Biome, ESLint + Prettier, or similar.
- Enforce in CI.

### 12. Expand test coverage
- Unit tests for `RateLimiter`, `SessionManager`, and config validation.
- Path-traversal regression test.
- `/ready` behavior test.
- Load / concurrency smoke test.

### 13. Pin Bun version in CI
- Replace `bun-version: latest` in `.github/workflows/test.yml` with a specific version.

---

## Suggested first milestone

If the goal is **deployable behind a reverse proxy with resource limits**, tackle items 1–4 first. That closes the biggest safety and deployability gaps without over-engineering the service.
