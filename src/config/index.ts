import { getEnvInt, getEnvString, getEnvBool } from "../utils";

export const config = {
  port: getEnvInt("PORT", 3080),
  sessionTimeoutMinutes: getEnvInt("SESSION_TIMEOUT_MINUTES", 10),
  executionTimeoutMs: getEnvInt("EXECUTION_TIMEOUT_MS", 60000),
  maxFileSizeBytes: getEnvInt("MAX_FILE_SIZE_BYTES", 10 * 1024 * 1024),
  maxFilesPerRequest: getEnvInt("MAX_FILES_PER_REQUEST", 10),
  rateLimitRequestsPerMin: getEnvInt("RATE_LIMIT_REQUESTS_PER_MIN", 10),
  maxSessions: getEnvInt("MAX_SESSIONS", 20),
  maxConcurrentInits: getEnvInt("MAX_CONCURRENT_INITS", 2),
  trustedProxyCount: getEnvInt("TRUSTED_PROXY_COUNT", 0),
  maxOutputFiles: getEnvInt("MAX_OUTPUT_FILES", 100),
  maxOutputByteSize: getEnvInt("MAX_OUTPUT_BYTE_SIZE", 10 * 1024 * 1024),
  logLevel: getEnvString("LOG_LEVEL", "info"),
  logFilePath: getEnvString("LOG_FILE_PATH", "./logs/app.log"),
  isProduction: getEnvBool("NODE_ENV_PRODUCTION", false),
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
if (config.maxSessions === 0) {
  throw new Error("MAX_SESSIONS must be greater than 0");
}
if (config.maxOutputFiles === 0) {
  throw new Error("MAX_OUTPUT_FILES must be greater than 0");
}
if (config.maxOutputByteSize === 0) {
  throw new Error("MAX_OUTPUT_BYTE_SIZE must be greater than 0");
}
if (config.maxConcurrentInits === 0) {
  throw new Error("MAX_CONCURRENT_INITS must be greater than 0");
}
