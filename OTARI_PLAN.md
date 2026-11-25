# Otari Python Code-Execution Adapter Plan

## Specification References

- Protocol semantics: <https://docs.otari.ai/reference/protocols/code-execution-protocol.md?displayAgentInstructions=false&markdownSource=page-action>
- Normative OpenAPI paths, shapes, and status codes: <https://github.com/mozilla-ai/otari/blob/v0.56.1/docs/public/code-execution-openapi.yaml>

## Goal

Expose Vivarium as an Otari-compatible backend for the `code_execution` tool
kind while preserving the existing `/exec` API and Pyodide-only isolation
model. The adapter will use Otari code-execution protocol v1 HTTP paths and
result shapes for Python execution, sessions, and workspace files.

This is intentionally not whole-contract conformance: `bash_code_execution`
and `text_editor_code_execution` are out of scope for this adapter. Vivarium
will reject those known-but-unsupported tool kinds with a protocol-shaped
`400` response. Supporting Bash safely needs a separately isolated shell
runtime, not a process spawned by the Bun server.

## Compatibility Boundary

The adapter lives beneath a base path, initially `/otari`:

| Otari operation | Vivarium adapter endpoint |
| --- | --- |
| CreateSession | `POST /otari/sessions` |
| Execute | `POST /otari/sessions/{session_id}/exec` |
| DestroySession | `DELETE /otari/sessions/{session_id}` |
| ListFiles | `GET /otari/sessions/{session_id}/files/list` |
| GetFile | `GET /otari/sessions/{session_id}/files?path=...` |
| PutFile | `POST /otari/sessions/{session_id}/files` |

Otari should be configured with an `OTARI_SANDBOX_URL` ending in `/otari`.
The existing endpoints—including `POST /exec?sessionId=...`—remain unchanged.

## Protocol Behavior

### Sessions

- `POST /sessions` accepts the optional `image`, `idle_timeout_seconds`, and
  `max_lifetime_seconds` hints. `image` is ignored without error because this
  backend has one fixed Pyodide environment.
- The server generates an opaque `session_id` using `randomUUID()`.
- Requested lifetime limits are clamped to configuration ceilings. The
  response reports the limits actually applied plus creation/activity times in
  POSIX seconds.
- An unknown session on all operations other than delete returns `404`.
  Execute must never auto-create a session.
- `DELETE` terminates the worker and returns `204`; deleting an unknown ID is
  also `204`.
- A session expires at the earlier of its idle timeout and maximum lifetime.
  Cleanup must run with sufficient precision for limits expressed in seconds.
- Session creation at capacity or unavailable worker initialization returns
  `503`, optionally with a valid `Retry-After` header. It must not reuse the
  legacy `413 resource_limit` response for this protocol route.

### Python execution

- `POST /sessions/{id}/exec` accepts only:

  ```json
  {
    "tool": "code_execution",
    "input": { "code": "print(2 + 2)" },
    "timeout_seconds": 60,
    "tool_use_id": "optional-correlation-id"
  }
  ```

- Generate a `tool_use_id` when it is absent and echo it both at the response
  root and in `result_block`.
- Clamp `timeout_seconds` to the configured execution-time limit and pass the
  effective limit into the worker-client timeout race. Do not hard-code a
  second limit.
- Successful Python execution returns HTTP `200` and this shape:

  ```json
  {
    "tool_use_id": "...",
    "execution_time_ms": 84,
    "result_block": {
      "type": "code_execution_tool_result",
      "tool_use_id": "...",
      "content": {
        "type": "code_execution_result",
        "stdout": "...",
        "stderr": "...",
        "return_code": 0,
        "content": []
      }
    }
  }
  ```

- A Python exception is still an HTTP `200`: set a nonzero `return_code` and
  include the diagnostic in `stderr`. Do not return Vivarium's legacy
  `{ success: false }` envelope.
- Unsupported known tool kinds and unknown tools return `400`; malformed
  bodies return `422` (or `400` for an unknown tool).
- A worker execution that cannot complete, including timeout recovery, uses a
  documented protocol-compatible operation error rather than the legacy `504`
  response. Define and test the precise status/error body before release.

### Files and workspace safety

- File routes are included even though optional in the protocol: Otari uses
  them for uploads, artifacts, and held-session reuse.
- `PutFile` accepts the specified multipart `file` and optional `path`, checks
  `MAX_FILE_SIZE_BYTES`, and returns `201` with `{ path, size_bytes }`.
- `GetFile` returns raw bytes with an appropriate media type. `ListFiles`
  returns relative paths, byte sizes, optional MIME types, and timestamps.
- Every path is normalized and confined to that session's `/home/earth`
  workspace. Absolute paths, traversal, NUL/control bytes, and paths that
  resolve outside the workspace return `403`.
- Output-file entries in an execution result have `type`, `file_id`, and
  `filename`. Do not include base64 contents in the Otari result block.
- Preserve existing configured limits for uploaded files and returned output.
  Add configuration only where a protocol operation requires an independently
  meaningful limit.

## Design Changes

### Configuration

Add validated configuration values for:

- Otari route prefix (or enable flag)
- maximum idle lease seconds
- maximum session lifetime seconds
- minimum cleanup cadence suitable for second-based leases

Continue to use `config` throughout; no route or worker limit is hard-coded.

### SessionManager

- Add server-generated creation for Otari sessions and a lookup-only operation
  that does not refresh or create unknown sessions.
- Store per-session idle/max-lifetime values and timestamps.
- Keep legacy session behavior unchanged, or migrate both APIs to the same
  richer session model without changing their observable behavior.
- Track whether an Otari session is executing. Reject concurrent adapter
  execution with `409` rather than queueing an indistinguishable second call.
- Ensure creation is atomic so concurrent creates cannot produce duplicate or
  overwritten sessions.

### Worker protocol

Extend the worker message protocol with typed operations for:

- listing workspace files with metadata;
- reading a workspace file as bytes;
- writing a workspace file as bytes;
- optionally collecting changed files for execution result references.

Keep all Pyodide filesystem access in `python-worker.ts`. Do not expose the
Pyodide instance or filesystem directly to the HTTP process, and preserve the
existing null-prototype globals, disabled filesystem backends, and disabled
runtime package/module registration.

### HTTP layer

- Add a dedicated Otari route module or Elysia plugin and mount it from
  `buildApp()`.
- Use adapter-specific error formatting so protocol routes produce `{ detail:
  ... }` (or another documented protocol error body), while legacy routes
  retain Vivarium's `{ success: false, error: ... }` format.
- Map exact protocol statuses: `201`, `200`, `204`, `400`/`422`, `403`, `404`,
  `409`, `413`, and `503` as applicable.
- Keep request IDs, safe logging, and metrics. Never log uploaded bytes,
  credentials, or file contents.

## Tests

Add fast unit tests with injected `EnvironmentFactory` for session lease
creation, lookup, expiration, maximum lifetime, deletion, capacity handling,
and concurrent-execution rejection.

Add integration coverage for:

- every adapter route and status code;
- state persistence across two Python executions;
- generated and supplied `tool_use_id` values;
- Python errors represented as a `200` result block with a nonzero return
  code;
- execution-time limit behavior and post-timeout session behavior;
- upload/list/download round trips, output artifacts, and binary data;
- workspace path traversal and oversized-file rejections;
- coexistence with the existing `/exec` API.

Run the Otari conformance checker against the adapter. It will document the
intentional unsupported-tool result; only claim full v1 conformance if all
required tool-kind checks pass.

## Deployment

- Run the adapter on a private network reachable only by Otari or an
  authentication/tenancy-aware front door.
- Keep the current container hardening and add explicit outbound-network
  restrictions when deployment policy requires it.
- Configure trusted proxies only when the actual proxy-hop count is known.
- Publish the supported compatibility level: Python `code_execution` plus
  session/files support, not Bash or text-editor support.

## Delivery Sequence

1. Define adapter types, status/error mapping, configuration, and tests.
2. Extend `SessionManager` for lease-aware server-generated sessions.
3. Extend the worker/client protocol for workspace file operations and
   per-call timeout limits.
4. Implement the Otari routes and result-block translation.
5. Add integration/security tests, run type checking and the existing suite.
6. Test against a local Otari instance and its conformance tooling; document
   the explicitly unsupported tool kinds and deployment configuration.

## Acceptance Criteria

- Otari can create a session, run multiple stateful Python calls, seed and
  retrieve files, and release or resume a leased session using Vivarium.
- Existing Vivarium clients and tests continue to work unchanged.
- The adapter never auto-creates a session during execute, never exposes a
  path outside a session workspace, and does not weaken Pyodide sandbox
  hardening.
- Protocol response envelopes, status codes, and Python-failure semantics are
  verified by integration tests.
- Documentation accurately labels the adapter as Python-only compatibility
  until Bash and text-editor tool kinds have safe implementations.
