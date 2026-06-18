FROM oven/bun:1.2-slim

WORKDIR /app

# Install curl for the HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (lockfile restores reproducible installs)
COPY package.json bun.lock ./
RUN bun install --production

# Copy application source
COPY src/ ./src/

# Copy the default Python home (required by the server at startup)
COPY default_python_home/ ./default_python_home/

# Pre-warm the Pyodide package cache so numpy, matplotlib, pandas are
# available on first container start without network downloads.
COPY pyodide_cache/ ./pyodide_cache/

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3080/ready || exit 1

CMD ["bun", "run", "src/index.ts"]
