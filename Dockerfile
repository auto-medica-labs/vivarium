FROM oven/bun:1.2-slim

WORKDIR /app

# Install curl for the HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (lockfile restores reproducible installs)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application source
COPY src/ ./src/

# Copy the default Python home (required by the server at startup)
COPY default_python_home/ ./default_python_home/

# Pre-warm Pyodide packages during the image build so containers do not need
# CDN access on first start.
RUN mkdir -p pyodide_cache \
  && bun -e 'import { loadPyodide } from "pyodide"; const pyodide = await loadPyodide({ packageCacheDir: "pyodide_cache" }); await pyodide.loadPackage(["numpy", "matplotlib", "pandas"]);' \
  && chown -R bun:bun pyodide_cache

USER bun

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3080/ready || exit 1

CMD ["bun", "run", "src/index.ts"]
