import logixlysia from "logixlysia";
import { config } from "./config";

const targets: any[] = [
  {
    target: "pino/file",
    options: { destination: 1 }, // stdout
  },
];

if (config.isProduction) {
  targets.push({
    target: "pino/file",
    options: { destination: config.logFilePath },
  });
}

const pinoTransport = { targets };

export const logixlysiaIns = logixlysia({
  config: {
    disableFileLogging: true,
    showStartupMessage: !config.isProduction,
    pino: {
      level: config.logLevel,
      messageKey: "msg",
      base: { service: "vivarium" },
      transport: pinoTransport,
      redact: {
        paths: ["password", "token", "apiKey", "b64_data"],
        remove: true,
      },
    },
  },
});

/**
 * Standalone Pino instance for use outside Elysia routes
 * (SessionManager, PythonInterpreter, startup/shutdown, etc.).
 */
export const logger = logixlysiaIns.store.pino;

/**
 * Create a child logger bound to request/session context.
 * Usage inside Elysia handlers:
 *   const reqLogger = createRequestLogger({ sessionId: "abc", requestId: "xyz" });
 *   reqLogger.info("Execution started");
 */
export const createRequestLogger = (context: {
  sessionId?: string;
  requestId?: string;
}) => logger.child(context);
