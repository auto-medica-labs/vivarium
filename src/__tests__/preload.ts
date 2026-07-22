// bun:test loads test files in parallel, so config must be initialized here rather than
// at the top of integration.test.ts.
process.env.MAX_SESSIONS = "3";
process.env.SESSION_TIMEOUT_MINUTES = "0.01";
process.env.EXECUTION_TIMEOUT_MS = "3000";
process.env.MAX_FILE_SIZE_BYTES = "50";
process.env.LOG_LEVEL = "fatal";
