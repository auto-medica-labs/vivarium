FROM oven/bun:1.1-slim

WORKDIR /app

# Install dependencies (lockfile omitted — bun 1.1 base predates lockfileVersion 1)
COPY package.json ./
RUN bun install --production

# Copy application source
COPY src/ ./src/

# Copy the default Python home (required by the server at startup)
COPY default_python_home/ ./default_python_home/

# Pre-warm the Pyodide package cache so numpy, matplotlib, pandas are
# available on first container start without network downloads.
COPY pyodide_cache/ ./pyodide_cache/

EXPOSE 3080

CMD ["bun", "run", "src/index.ts"]
