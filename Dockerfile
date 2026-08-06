FROM oven/bun:1.3-alpine AS base

WORKDIR /app

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

# Production stage with minimal footprint
FROM oven/bun:1.3-alpine

WORKDIR /app

# Copy only production dependencies (no devDependencies)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit=dev

# Copy pre-built Pyodide cache and application from build stage
COPY --from=base /app /app

USER bun

EXPOSE 3080

# Use Bun's built-in fetch for health check - no external dependencies needed
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://localhost:3080/ready"); if (!r.ok) process.exit(1)'

CMD ["bun", "run", "src/index.ts"]
