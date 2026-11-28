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
  otariRoutePrefix: getEnvString("OTARI_ROUTE_PREFIX", "/otari").replace(/\/$/, ""),
  otariMaxIdleTimeoutSeconds: getEnvInt("OTARI_MAX_IDLE_TIMEOUT_SECONDS", 600),
  otariMaxLifetimeSeconds: getEnvInt("OTARI_MAX_LIFETIME_SECONDS", 3600),
  otariCleanupIntervalMs: getEnvInt("OTARI_CLEANUP_INTERVAL_MS", 1000),
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
if (!config.otariRoutePrefix.startsWith("/") || config.otariRoutePrefix === "") {
  throw new Error("OTARI_ROUTE_PREFIX must be an absolute URL path");
}
if (config.otariMaxIdleTimeoutSeconds === 0) {
  throw new Error("OTARI_MAX_IDLE_TIMEOUT_SECONDS must be greater than 0");
}
if (config.otariMaxLifetimeSeconds === 0) {
  throw new Error("OTARI_MAX_LIFETIME_SECONDS must be greater than 0");
}
if (config.otariCleanupIntervalMs === 0 || config.otariCleanupIntervalMs > 1000) {
  throw new Error("OTARI_CLEANUP_INTERVAL_MS must be between 1 and 1000");
}
