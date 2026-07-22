# Vivarium — Agent Context

Vivarium is a Bun/TypeScript HTTP server that runs Python with Pyodide in one Bun `Worker` per session.

## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:

- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.

## Stack and entrypoints

- Runtime: Bun, TypeScript, ES modules
- HTTP: Elysia (`src/app.ts`)
- Python runtime: Pyodide (`src/service/python-worker.ts`)
- Sessions: `src/service/session-manager.ts`
- Worker client/timeouts: `src/service/python-interpreter.ts`
- Startup/shutdown: `src/index.ts`
- Tests: Bun's `bun:test` runner under `src/__tests__/`

## Rules

- Use `config` from `src/config/index.ts`; do not hard-code limits.
- Throw `AppError(type, message)` from handlers so global error formatting applies.
- Never log `b64_data`, tokens, passwords, or API keys.
- Clean up sessions and rate-limiters in tests.
- Do not attempt to interrupt CPU-bound Python from the main thread. Timeouts kill and respawn the worker.
- Preserve sandbox hardening in `python-worker.ts`: null-prototype globals/functions, disabled dangerous filesystem backends, and disabled runtime package/module registration.

## Test note

Configuration is evaluated at import time. Integration tests set environment variables before dynamically importing `buildApp()`. Real Pyodide initialization is slow; use the injected `EnvironmentFactory` in `SessionManager` for unit tests.
