# Phase 3 — Testing

**Effort:** ~3 hours  
**Goal:** Integration tests covering the full API surface and error paths. Bun's built-in test runner — no extra dependencies.

## Test Suite

All tests in `src/__tests__/integration.test.ts` (single file, ~200-300 lines).

### 1. Basic Execution

```
POST /exec?sessionId=basic-test
Body: { "code": "print('hello')" }
→ 200, success: true, std_out contains "hello"
```

### 2. Expression Result

```
POST /exec?sessionId=expr-test
Body: { "code": "2 + 2" }
→ 200, final_expression is 4
```

### 3. Session Lifecycle

- Create session via `/exec` → session appears in `GET /sessions`.
- Wait for session timeout (set `SESSION_TIMEOUT_MINUTES=0.01` for test).
- Verify session disappears from `GET /sessions`.

### 4. File Upload / Download

```
POST /exec?sessionId=file-test
Body: {
  "code": "with open('data.csv') as f: print(f.read())",
  "files": [{ "filename": "data.csv", "b64_data": "aGVsbG8=" }]
}
→ 200, std_out contains "hello"
```

### 5. Resource Limits — File Count

```
POST /exec?sessionId=limit-test
Body: { "code": "pass", "files": [ ... 11 files ... ] }
→ 200 (HTTP), success: false, error.type: "resource_limit"
```

### 6. Resource Limits — File Size

```
POST /exec?sessionId=size-test
Body: { "code": "pass", "files": [{ "filename": "big.bin", "b64_data": "<11MB base64>" }] }
→ 200 (HTTP), success: false, error.type: "resource_limit"
```

### 7. Execution Timeout

```
POST /exec?sessionId=timeout-test
Body: { "code": "while True: pass" }
→ 200 (HTTP after timeout), success: false, error.type: "timeout"
→ Session still usable (next request succeeds)
```

### 8. Rate Limiting

- Send 11 rapid requests → first 10 succeed, 11th returns 429.

### 9. Session Cap

- Create MAX_SESSIONS (use low value for test, e.g. 3).
- 4th session → `error.type: "resource_limit"`.

### 10. Missing sessionId

```
POST /exec  (no query param)
→ 422 (Elysia schema validation) or 200 with error.type: "validation"
```

### 11. Python Error

```
POST /exec?sessionId=error-test
Body: { "code": "print(undefined_var)" }
→ 200, success: false, error.type is Python error type (NameError)
```

## Test Setup

- Spin up the Elysia app programmatically (import `app` from `src/index.ts` needs a refactor to export the app instance without `.listen()`).
- Use `bun test` with `--timeout 30000` for timeout tests.
- Set env vars inline: `SESSION_TIMEOUT_MINUTES=0.01 EXECUTION_TIMEOUT_MS=3000 bun test`.

## Refactor Needed

The test setup requires extracting the Elysia app creation from `.listen()` so tests can import the app and use `app.handle()` for in-process HTTP testing. Minimal change: split `src/index.ts` into `src/app.ts` (app definition + routes) and `src/index.ts` (config, listen, signals).

**File changes:**
- `src/app.ts` (new) — `export const app = new Elysia()...` with all routes and middleware.
- `src/index.ts` — `import { app } from './app';` then `app.listen(config.port)` + signal handlers.
