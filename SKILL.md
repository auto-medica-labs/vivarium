---
name: vivarium-python-sandbox
description: Activate this skill when you need to run arbitrary Python code or perform data analysis using Python — including numerical computing (numpy), plotting/visualization (matplotlib), or tabular data processing (pandas). Sets up a sandboxed Docker container, verifies health, executes code, manages files and sessions, and tears down cleanly.
---

# Vivarium Python Sandbox

Self-contained instructions for provisioning and operating a sandboxed Python runtime using the Vivarium server. The server runs inside Docker with Pyodide (Python compiled to WebAssembly), providing isolation with no network access, no pip, no subprocess, and no shell.

## Setup

### 1. Pull the Docker Image

```bash
docker pull {{DOCKER_IMAGE}}
```

Replace `{{DOCKER_IMAGE}}` with your actual registry URL and image name (e.g. `ghcr.io/you/vivarium:latest`).

### 2. Run the Container

```bash
docker run -d --name vivarium -p 3080:3080 {{DOCKER_IMAGE}}
```

- `-d` runs in detached (background) mode
- `--name vivarium` gives the container a predictable name
- `-p 3080:3080` maps the server port to your host

**Port conflicts:** If port 3080 is already in use, remap it:

```bash
docker run -d --name vivarium -p 8888:3080 {{DOCKER_IMAGE}}
```

Then use `http://localhost:8888` instead of `http://localhost:3080` in all commands.

### 3. Verify Server Health

```bash
curl -s http://localhost:3080/health
```

Expected response:

```json
{
  "status": "healthy",
  "active_sessions": 0
}
```

Wait and retry if the server is not yet ready. The first start may take a few seconds as Pyodide initializes.

## Usage

### Base URL

All API calls go to `http://localhost:3080`. If you remapped the port, adjust accordingly.

### Session Management

Session IDs are **client-chosen** — you pick any string as the session ID (e.g. `default`, `analysis-1`, `plot-task`). Pass it as a query parameter `sessionId` on every `/exec` request.

**Strategy:** Use a single default session (e.g. `sessionId=default`) for most work. Create additional sessions only when you need isolated environments (e.g. different file contexts, separate tasks).

Sessions timeout after **10 minutes of idle time** and are automatically cleaned up.

### Execute Python Code

**Endpoint:** `POST /exec?sessionId=<your-session-id>`

**Request body:**

```json
{
  "code": "print('Hello, world!')",
  "files": []
}
```

| Field    | Type     | Required | Description                          |
| -------- | -------- | -------- | ------------------------------------ |
| `code`   | string   | Yes      | Python code to execute               |
| `files`  | array    | No       | Array of `{ filename, b64_data }`    |

**File limits:** Max **10 files** per request, max **10 MB** per file.

**Example — simple execution:**

```bash
curl -s -X POST "http://localhost:3080/exec?sessionId=default" \
  -H "Content-Type: application/json" \
  -d '{"code": "print(2 + 2)"}'
```

**Example — execute with a file upload:**

```bash
curl -s -X POST "http://localhost:3080/exec?sessionId=default" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "import pandas as pd; df = pd.read_csv(\"data.csv\"); print(df.head())",
    "files": [{
      "filename": "data.csv",
      "b64_data": "bmFtZSxhZ2UKQWxpY2UsMzAKQm9iLDI1Cg=="
    }]
  }'
```

The `b64_data` field contains the base64-encoded content of the file. Files are written to `/home/earth` inside the sandbox before execution.

### Response Format

**Successful execution:**

```json
{
  "success": true,
  "result": {
    "success": true,
    "std_out": "4\n",
    "std_err": "",
    "output_files": [],
    "code_runtime": 42
  }
}
```

| Field               | Type     | Description                                  |
| ------------------- | -------- | -------------------------------------------- |
| `success`           | boolean  | Always `true` for successful execution       |
| `result`            | object   | Execution result                             |
| `result.std_out`    | string   | Standard output from the Python code         |
| `result.std_err`    | string   | Standard error from the Python code          |
| `result.output_files` | array  | Output files as `{ filename, b64_data }`     |
| `result.code_runtime` | number | Execution time in milliseconds               |

**Failed execution (Python error):**

```json
{
  "success": false,
  "error": {
    "type": "NameError",
    "message": "PythonError: ... name 'x' is not defined\n\nCode context:\n1: print(x)"
  },
  "std_out": "",
  "std_err": "",
  "code_runtime": 15
}
```

**Failed execution (validation / resource limits):**

```json
{
  "success": false,
  "error": {
    "type": "validation",
    "message": "sessionId query parameter is required"
  }
}
```

Note: If `sessionId` is omitted from the URL entirely, Elysia's built-in schema validator returns a detailed validation object before the handler runs.

### Error Types

| Error Type       | Description                              | Agent Action                                      |
| ---------------- | ---------------------------------------- | ------------------------------------------------- |
| `validation`     | Missing or malformed request fields      | Fix the request body or query parameters and retry|
| `NameError`, `TypeError`, `SyntaxError`, etc. | Python exception raised | Read the error message and code context, fix the code, retry |
| `parsing`        | File data is missing or malformed        | Ensure each file has both `filename` and `b64_data` fields |
| `resource_limit` | Too many files or file too large         | Reduce file count to ≤10 or file size to ≤10 MB   |
| `timeout`        | Code exceeded execution time limit       | Optimize code or break into smaller chunks        |
| `system`         | Unexpected server-side error             | Retry once; if it persists, restart the container |

### List Active Sessions

**Endpoint:** `GET /sessions`

```bash
curl -s http://localhost:3080/sessions
```

Response:

```json
{
  "sessions": [
    {
      "id": "default",
      "createdAt": 1705312200000,
      "lastAccessedAt": 1705312500000,
      "ageMinutes": 5.0,
      "idleMinutes": 0.5
    }
  ]
}
```

### Check Server Health

**Endpoint:** `GET /health`

```bash
curl -s http://localhost:3080/health
```

Response:

```json
{
  "status": "healthy",
  "active_sessions": 1
}
```

### File System Layout

| Path            | Description                              |
| --------------- | ---------------------------------------- |
| `/home/earth`   | Working directory; files are read from and written here |

Files uploaded via the `files` array are placed in `/home/earth` before code execution. Any files your code writes to `/home/earth` will be returned in the response's `files` array (base64-encoded).

### Pre-loaded Python Packages

The following packages are available without installation:

- **numpy** — numerical computing
- **matplotlib** — plotting and visualization
- **pandas** — data analysis and manipulation

### Sandbox Limitations

The sandbox runs Python via Pyodide (WebAssembly). The following are **not available**:

- **No network access** — cannot make HTTP requests, connect to sockets, etc.
- **No pip** — cannot install additional packages at runtime
- **No subprocess** — cannot spawn child processes or run shell commands
- **No shell access** — `os.system`, `subprocess`, etc. are not available

### Rate Limiting

The server enforces a default rate limit of **10 requests per minute** per IP/session. If you hit the limit, wait and retry. Do not send rapid bursts of requests.

## Troubleshooting

| Symptom                              | Cause                      | Fix                                              |
| ------------------------------------ | -------------------------- | ------------------------------------------------ |
| Health check fails / connection refused | Server not running       | Run `docker run` command to start the container  |
| `sessionId` validation error         | Missing query parameter    | Add `?sessionId=default` to the request URL      |
| `resource_limit` error               | Too many or too large files| Reduce to ≤10 files, each ≤10 MB                 |
| `timeout` error                      | Code ran too long          | Optimize code; avoid infinite loops              |
| `execution` error (NameError, TypeError, etc.) | Python exception           | Read error message and code context; fix code and retry |
| Container not responding             | Server crashed             | `docker restart vivarium`                        |
| Port already in use                  | Port 3080 taken            | Use `-p <other-port>:3080` in the docker run command |

## Cleanup

When you are done using the sandbox:

```bash
docker stop vivarium
docker rm vivarium
```

This stops the container and removes it, freeing all resources.
