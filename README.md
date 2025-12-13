# Vivarium - Python Sandbox Web Server

> A vivarium (Latin for 'place of life'; pl. vivaria or vivariums) is an area,
> usually enclosed, for keeping and raising animals or plants
> for observation or research.

**Vivarium** is a web server that provides a sandboxed Python execution environment using Pyodide (WebAssembly-based Python interpreter). It allows safe execution of Python code in isolated sessions with automatic cleanup and resource management.

> Vivarium is largely influence by [cohere-terrarium](https://github.com/cohere-ai/cohere-terrarium)
> but added sessions base execution instead of ad-hocs base execution
> and since it did not recieves any new commit for a year,
> I decide to create vivarium from the groud up with bun.

## Features

- ✅ **Sandboxed Python Execution**: Run Python code safely in isolated WebAssembly environments
- ✅ **Session Management**: Automatic session creation, cleanup, and timeout handling
- ✅ **File System Support**: Upload/download files to/from the Python environment
- ✅ **Package Pre-loading**: Common packages (numpy, matplotlib, pandas) are pre-loaded for faster execution
- ✅ **REST API**: Simple HTTP interface for code execution
- ✅ **Health Monitoring**: Endpoints for monitoring server health and active sessions
- ✅ **Automatic Cleanup**: Expired sessions are automatically cleaned up

## Technology Stack

- **Backend Framework**: [Elysia.js](https://elysiajs.com/) - Fast TypeScript web framework
- **Python Engine**: [Pyodide](https://pyodide.org/) - Python in WebAssembly
- **Runtime**: Bun.js - Fast JavaScript runtime
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
- Safe execution with interrupt support
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

- `validation`: Missing required parameters
- `execution`: Python code execution errors
- `parsing`: File parsing errors

## Setup and Installation

### Prerequisites

- [Bun.js](https://bun.sh/) (recommended) or Node.js
- Python (for development, not required for runtime)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/vivarium.git
cd vivarium

# Install dependencies
bun install
```

### Configuration

The server runs on port `3080` by default. You can change this in `src/index.ts`.

Session timeout is configurable (default: 10 minutes). Modify the `SessionManager` constructor in `src/index.ts`:

```typescript
const sessionManager = new SessionManager(10); // 10 minutes
```

### Running the Server

```bash
# Development mode (with hot reload)
bun run dev

# Production mode
bun run src/index.ts
```

### Environment Variables

Create a `.env` file for configuration:

```env
PORT=3080
SESSION_TIMEOUT_MINUTES=10
PYODIDE_CACHE_DIR=pyodide_cache
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
├── service/              # Core services
│   ├── python-interpreter.ts  # Python execution engine
│   ├── session-manager.ts     # Session management
│   └── types.ts              # Type definitions
├── utils/                # Utility functions
│   └── async-utils.ts     # Async helpers
└── index.ts              # Main server entry
```

### Building

```bash
bun run build
```

### Testing

```bash
# Run tests (add your test framework)
bun test
```

## Deployment

### Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY . .
RUN bun install
CMD ["bun", "run", "src/index.ts"]
```

### Cloud Platforms

Vivarium can be deployed to:

- Vercel
- AWS Lambda
- Google Cloud Functions
- Azure Functions
- Any platform supporting Bun.js/Node.js

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
- Monitor active sessions regularly
- Set appropriate session timeouts based on your use case
- Consider rate limiting for public APIs

## Performance Optimization

### Caching

- Pyodide packages are cached in `pyodide_cache/` directory
- Common packages are pre-loaded to reduce startup time
- Session reuse for the same user reduces initialization overhead

### Memory Management

- Automatic cleanup of expired sessions
- Interrupt support for long-running code
- SharedArrayBuffer for efficient interrupt handling

## Troubleshooting

### Common Issues

**Pyodide loading fails:**

- Check network connectivity
- Verify cache directory permissions
- Ensure sufficient memory allocation

**Session timeout issues:**

- Adjust `SESSION_TIMEOUT_MINUTES` in configuration
- Monitor `/sessions` endpoint for active sessions

**File system errors:**

- Verify base64 encoding of file content
- Check file paths and permissions
- Ensure files are properly formatted

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request
5. Follow TypeScript coding standards

## License

[MIT License](LICENSE)

## Roadmap

- [ ] Add authentication middleware
- [ ] Support for custom package installation
- [ ] WebSocket interface for real-time output
- [ ] Session persistence across server restarts
- [ ] Enhanced error reporting with stack traces
- [ ] Performance metrics and monitoring
- [ ] Rate limiting and request throttling

## Support

For issues, questions, or feature requests:

- Open an issue on GitHub
- Check the documentation
- Review existing discussions

## Acknowledgements

- [Pyodide](https://pyodide.org/) - Python in WebAssembly
- [Elysia.js](https://elysiajs.com/) - Fast TypeScript web framework
- [Bun.js](https://bun.sh/) - Fast JavaScript runtime
