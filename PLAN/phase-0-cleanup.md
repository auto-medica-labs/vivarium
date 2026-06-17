# Phase 0 — Cleanup

**Effort:** 30 min  
**Goal:** Strip dead weight before touching prod-critical code.

## Tasks

### 1. Delete `src/utils/async-utils.ts`

- 79 lines, never imported anywhere in the codebase.
- `doWithLock()` and `waitFor()` are both dead code.
- If a per-session execution lock is needed later (Phase 2), it's 5 lines inline — no need for the generic util.

### 2. Remove `@elysiajs/openapi`

- Imported in `src/index.ts` and called via `.use(openapi())`.
- Nothing in the project consumes or serves OpenAPI/Swagger docs.
- Remove the import, the `.use()`, and the dependency from `package.json`.
- Re-add later if a Swagger UI consumer is actually built.

### 3. Pin `elysia` version in `package.json`

- Currently `"elysia": "latest"` — breaking changes arrive silently on deploy.
- Replace with the currently installed version (check `bun.lock` / `node_modules`).
- Use caret range (e.g. `^1.2.38`) to allow patches.

### 4. Fix `readonly` on `sessionTimeout` in `SessionManager`

- File: `src/service/session-manager.ts`
- `private readonly sessionTimeout: number = 10 * 60 * 1000;` — the `readonly` is misleading because the field is overwritten in the constructor. Remove the `readonly` modifier and the default value (constructor always sets it).

### Verifying

```bash
bun run src/index.ts   # server starts without errors
```
