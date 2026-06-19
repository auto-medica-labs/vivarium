# Vivarium - Python Sandbox Web Server

> A vivarium (Latin for 'place of life'; pl. vivaria or vivariums) is an area,
> usually enclosed, for keeping and raising animals or plants for observation or
> research.

**Vivarium** is a web server that provides a sandboxed Python execution
environment using Pyodide (WebAssembly-based Python interpreter). It allows safe
execution of Python code in isolated sessions with automatic cleanup and
resource management.

> Vivarium is heavy influenced by
> [cohere-terrarium](https://github.com/cohere-ai/cohere-terrarium) but added
> sessions based execution instead of ad-hocs based execution, and since
> terrarium did not recieve any new commit for a year, I decide to created
> vivarium from the ground up with bun and elysiajs.

## Features

- ✅ **Sandboxed Python Execution**: Run Python code safely in isolated
  WebAssembly environments
- ✅ **Session Management**: Automatic session creation, cleanup, and timeout
  handling
- ✅ **File System Support**: Upload/download files to/from the Python
  environment
- ✅ **Package Pre-loading**: Common packages (numpy, matplotlib, pandas) are
  pre-loaded for faster execution
- ✅ **REST API**: Simple HTTP interface for code execution
- ✅ **Health & Readiness Monitoring**: `/health`, `/ready`, `/sessions`, and
  `/metrics` endpoints
- ✅ **Automatic Cleanup**: Expired sessions are automatically cleaned up
- ✅ **Resource Limits**: Configurable caps on file count, file size, active
  sessions, and request rate
- ✅ **Structured Logging**: JSON logs via `pino` with request context and
  sensitive-field redaction
- ✅ **Integration Tests**: Full API coverage using Bun's built-in test runner

## Technology Stack

- **Backend Framework**: [Elysia.js](https://elysiajs.com/) - Fast TypeScript
  web framework
- **Python Engine**: [Pyodide](https://pyodide.org/) - Python in WebAssembly
- **Runtime**: [Bun.js](https://bun.sh/) - Fast JavaScript runtime
- **Language**: TypeScript - Type-safe JavaScript

## Key Components

### Session Manager

- Manages multiple Python execution sessions
- Automatic session timeout (configurable, default: 10 minutes)
- Periodic cleanup of expired sessions
- Session health monitoring

### Python Environment

- Pyodide-based Python interpreter
- Isolated file system per session
- Pre-loaded common packages (numpy, matplotlib, pandas)
- Safe execution with hard timeouts via Bun Workers
- File I/O support with base64 encoding

### API Documentation

### Base URL

```
http://localhost:3080
```

### Endpoints

#### POST `/exec` - Execute Python Code

Execute Python code in a sandboxed environment.

**Parameters:**

- `sessionId` (query, required): Unique session identifier
- `code` (body, required): Python code to execute
- `files` (body, optional): Array of files to upload to the environment

**Request Body:**

```json
{
  "code": "print('Hello World')",
  "files": [
    {
      "filename": "data.txt",
      "b64_data": "SGVsbG8gV29ybGQ="
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "final_expression": "Hello World",
    "output_files": [
      {
        "filename": "output.txt",
        "b64_data": "SGVsbG8gV29ybGQ="
      }
    ],
    "std_out": "Hello World\n",
    "std_err": "",
    "code_runtime": 123
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": {
    "type": "execution",
    "message": "SyntaxError: invalid syntax"
  }
}
```

#### GET `/health` - Server Health Check

Check server health and get active session count.

**Response:**

```json
{
  "status": "healthy",
  "activeSessions": 5
}
```

#### GET `/ready` - Readiness Probe

Quick server check. Returns 200 when the HTTP server is up and able to respond.
This endpoint intentionally does **not** spawn Pyodide; use `/health` or an actual `/exec` call to verify Python execution capability.

**Response:**

```json
{
  "status": "ready"
}
```

#### GET `/metrics` - Prometheus Metrics

Expose request counters, execution durations, and active session gauge in
Prometheus text format.

#### GET `/sessions` - List Active Sessions

Get information about all active sessions.

**Response:**

```json
{
  "sessions": [
    {
      "id": "session-123",
      "createdAt": 1712345678901,
      "lastAccessedAt": 1712345678901,
      "ageMinutes": 5.2,
      "idleMinutes": 2.1
    }
  ]
}
```

## Request/Response Format

### File Format

Files are transferred using base64 encoding:

```json
{
  "filename": "example.txt",
  "b64_data": "base64_encoded_content"
}
```

### Error Types

- `validation`: Missing or invalid parameters
- `resource_limit`: File count/size, session cap, or rate limit exceeded
- `timeout`: Code execution exceeded `EXECUTION_TIMEOUT_MS`
- `execution`: Python code execution errors (includes Python exception names
  such as `NameError`)
- `system`: Unexpected server errors
- `parsing`: File parsing errors

## Setup and Installation

### Prerequisites

- [Bun.js](https://bun.sh/)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/vivarium.git
cd vivarium

# Install dependencies
bun install
```

### Configuration

Vivarium is configured through environment variables. Copy `.env.example` to
`.env` and adjust values as needed:

```env
PORT=3080
SESSION_TIMEOUT_MINUTES=10
EXECUTION_TIMEOUT_MS=30000
MAX_FILE_SIZE_BYTES=10485760
MAX_FILES_PER_REQUEST=10
RATE_LIMIT_REQUESTS_PER_MIN=10
MAX_SESSIONS=20
LOG_LEVEL=info
LOG_FILE_PATH=./logs/app.log
NODE_ENV_PRODUCTION=false
```

### Running the Server

```bash
bun run src/index.ts
```

## Usage Examples

### Basic Python Execution

```bash
curl -X POST "http://localhost:3080/exec?sessionId=test-session" \
  -H "Content-Type: application/json" \
  -d '{"code": "print(\"Hello from Python!\")"}'
```

### With File Upload

```bash
curl -X POST "http://localhost:3080/exec?sessionId=test-session" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "import pandas as pd\ndf = pd.read_csv(\"data.csv\")\nprint(df.head())",
    "files": [
      {
        "filename": "data.csv",
        "b64_data": "Y29sdW1uMSx2YWx1ZTEKY29sdW1uMiw="
      }
    ]
  }'
```

### Health Check

```bash
curl http://localhost:3080/health
```

### List Sessions

```bash
curl http://localhost:3080/sessions
```

## Python Environment

### Pre-loaded Packages

The following packages are pre-loaded for faster execution:

- `numpy` - Numerical computing
- `matplotlib` - Plotting and visualization
- `pandas` - Data analysis

### File System

Each session has an isolated file system with:

- Home directory: `/home/earth`
- Persistent files across executions within the same session
- Base64 encoding for file transfer

### Supported Operations

- ✅ File read/write operations
- ✅ Directory creation and navigation
- ✅ Multiple file uploads/downloads
- ✅ Package imports (Pyodide built-in packages)

## Development

### Project Structure

```
src/
├── app.ts                    # Elysia app definition and routes
├── config/                   # Environment configuration
│   └── index.ts
├── errors.ts                 # Structured application errors
├── index.ts                  # Server bootstrap and shutdown
├── logger.ts                 # Structured logging setup
├── metrics.ts                # Prometheus metrics
├── service/
│   ├── python-interpreter.ts # Worker-based Pyodide runner
│   ├── python-worker.ts      # Bun Worker running Pyodide
│   ├── session-manager.ts    # Session lifecycle management
│   └── types.ts
└── __tests__/
    └── integration.test.ts   # Integration tests
```

### Testing

Run the integration test suite with Bun:

```bash
bun test
```

Tests exercise the full API surface, including resource limits, timeouts,
session lifecycle, rate limiting, and Python errors. They use Bun's built-in
test runner and require no additional dependencies.

## Deployment

### Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install
CMD ["bun", "run", "src/index.ts"]
```

## Security Considerations

### Sandboxing

- Pyodide runs in WebAssembly, providing isolation from the host system
- No direct access to host filesystem or network
- Limited JavaScript globals exposed to Python

### Session Management

- Automatic session expiration (configurable timeout)
- Regular cleanup of inactive sessions
- Session isolation (no shared state between sessions)

### Best Practices

- Use unique session IDs for each user/request
- Monitor active sessions via `/sessions` and `/metrics`
- Set appropriate timeouts and resource limits based on your use case
- Keep `NODE_ENV_PRODUCTION=true` in production for NDJSON log output

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request
5. Follow TypeScript coding standards

## License

MIT

## Support

For issues, questions, or feature requests:

- Open an issue on GitHub
- Check the documentation
- Review existing discussions

## Acknowledgements

- [cohere-terrarium](https://github.com/cohere-ai/cohere-terrarium) -
  inspiration
- [Pyodide](https://pyodide.org/) - Python in WebAssembly
- [Elysia.js](https://elysiajs.com/) - Fast TypeScript web framework
- [Bun.js](https://bun.sh/) - Fast JavaScript runtime
