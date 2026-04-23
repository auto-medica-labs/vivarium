function getEnvInt(name: string, defaultValue: number): number {
  const val = process.env[name];
  if (val === undefined || val === "") return defaultValue;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(
      `Environment variable ${name} must be a non-negative integer, got: ${val}`,
    );
  }
  return parsed;
}

function getEnvString(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  port: getEnvInt("PORT", 3080),
  sessionTimeoutMinutes: getEnvInt("SESSION_TIMEOUT_MINUTES", 10),
  executionTimeoutMs: getEnvInt("EXECUTION_TIMEOUT_MS", 60000),
  maxFileSizeBytes: getEnvInt("MAX_FILE_SIZE_BYTES", 10 * 1024 * 1024),
  maxFilesPerRequest: getEnvInt("MAX_FILES_PER_REQUEST", 10),
  rateLimitRequestsPerMin: getEnvInt("RATE_LIMIT_REQUESTS_PER_MIN", 10),
  logLevel: getEnvString("LOG_LEVEL", "info"),
} as const;

// Validate logical constraints
if (config.executionTimeoutMs === 0) {
  throw new Error("EXECUTION_TIMEOUT_MS must be greater than 0");
}
if (config.maxFileSizeBytes === 0) {
  throw new Error("MAX_FILE_SIZE_BYTES must be greater than 0");
}
if (config.maxFilesPerRequest === 0) {
  throw new Error("MAX_FILES_PER_REQUEST must be greater than 0");
}
