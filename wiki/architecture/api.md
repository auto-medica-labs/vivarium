# HTTP API

Base URL in examples: `http://localhost:3080`.

## Execute Python — `POST /exec?sessionId=<id>`

The query must contain a string `sessionId`. The JSON body must contain a string `code`; `files` is optional and defaults to an empty array.

```json
{
  "code": "with open('input.txt') as f: print(f.read())",
  "files": [{
    "filename": "input.txt",
    "b64_data": "aGVsbG8="
  }]
}
```

Files are decoded and written to `/home/earth` in the session's in-memory filesystem before execution. Filenames cannot contain `..`, start with `/`, contain NUL, or contain control characters. State and files persist across calls using the same session until the session expires or is terminated.

Success returns the worker result under `result`:

```json
{
  "success": true,
  "result": {
    "final_expression": 4,
    "output_files": [],
    "std_out": "",
    "std_err": "",
    "code_runtime": 12
  }
}
```

`final_expression` is the value returned by Pyodide for the submitted code. `output_files` contains files present under `/home/earth`, excluding default files and files supplied in the current request, encoded as `{filename, b64_data}`. `std_out` and `std_err` contain captured output; `code_runtime` is milliseconds.

Python failures retain HTTP 200 because the interpreter ran and returned a result:

```json
{
  "success": false,
  "error": {"type": "NameError", "message": "..."},
  "std_out": "",
  "std_err": "",
  "code_runtime": 8
}
```

## Service endpoints

- `GET /ready` returns `{ "status": "ready" }` without starting Pyodide. It is the Docker healthcheck target.
- `GET /health` returns `status`, active session count, whether the session cleanup interval is running, and whether `pyodide_cache` is readable from the server working directory. It does not boot a worker.
- `GET /sessions` returns active session metadata: ID, creation/access timestamps, age in minutes, and idle time in minutes.
- `GET /metrics` returns Prometheus-compatible text. It sets `Content-Type: text/plain`.

## Limits and errors

Defaults are configured by environment variables; see [operations](../operations.md).

| Condition                                        | Error type                       | HTTP status |
| ------------------------------------------------ | -------------------------------- | ----------: |
| Missing/invalid request schema or filename       | `validation`                     |         400 |
| Defensive malformed-file result from the worker  | `parsing`                        |         200 |
| Too many files, oversized upload, or session cap | `resource_limit`                 |         413 |
| Per-IP window exceeded                           | `rate_limit`                     |         429 |
| Execution exceeds the hard timeout               | `timeout`                        |         504 |
| Unexpected server/worker failure                 | `system`                         |         500 |
| Python exception                                 | exception name, e.g. `NameError` |         200 |

Uploads are limited by `MAX_FILES_PER_REQUEST` and `MAX_FILE_SIZE_BYTES` per file. Returned files are bounded independently by `MAX_OUTPUT_FILES` and `MAX_OUTPUT_BYTE_SIZE`; collection stops when either cap is reached. The normal route validates the typed request before the worker, so `parsing` is a defensive result rather than the usual malformed-request path.

## Request identity and rate limiting

Every request receives an `x-request-id` response header. A supplied `x-request-id` is preserved; otherwise the server generates a UUID. Rate limiting applies to non-probe endpoints, including `/exec` and `/sessions`, and uses the direct connection IP by default. Configure `TRUSTED_PROXY_COUNT` only when the deployment has that many trusted reverse proxies.

There is no authentication or authorization in the application. Any client that can reach the HTTP port can execute Python and inspect sessions/metrics; put it behind network access control or an authenticated reverse proxy.
