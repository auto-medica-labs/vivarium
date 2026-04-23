import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { randomUUID } from "crypto";
import { SessionManager } from "./service/session-manager";
import { config } from "./config";
import { logixlysiaIns, logger, createRequestLogger } from "./logger";

const sessionManager = new SessionManager(config.sessionTimeoutMinutes);
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

const app = new Elysia()
  .onRequest(({ set, request }) => {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    set.headers["x-request-id"] = requestId;
  })
  .use(logixlysiaIns)
  .use(openapi())
  .post(
    "/exec",
    async ({ body, query, store, request }) => {
      const { code, files = [] } = body;
      const { sessionId } = query;
      const requestId = request.headers.get("x-request-id") || undefined;

      const pinoFromStore = store.pino;
      const reqLogger = pinoFromStore
        ? pinoFromStore.child({ sessionId, requestId })
        : createRequestLogger({ sessionId, requestId });

      if (!sessionId) {
        reqLogger.warn(
          { reason: "missing_session_id" },
          "Rejecting request: missing sessionId",
        );
        return {
          success: false,
          error: {
            type: "validation",
            message: "sessionId query parameter is required",
          },
        };
      }

      if (files.length > config.maxFilesPerRequest) {
        reqLogger.warn(
          { fileCount: files.length, maxAllowed: config.maxFilesPerRequest },
          "Resource limit hit: too many files",
        );
        return {
          success: false,
          error: {
            type: "resource_limit",
            message: `Too many files. Maximum allowed is ${config.maxFilesPerRequest}, received ${files.length}`,
          },
        };
      }

      try {
        const session = await sessionManager.getOrCreateSession(sessionId);
        reqLogger.info(
          { sessionAgeMs: Date.now() - session.createdAt },
          "Session acquired",
        );

        const result = await session.environment.runCode(code, files);
        reqLogger.info(
          { success: result.success, runtimeMs: result.code_runtime },
          "Execution finished",
        );

        if (!result.success) {
          reqLogger.warn({ errorType: result.error?.type }, "Execution failed");
          return result as any;
        }

        return { success: true, result };
      } catch (error: any) {
        reqLogger.error({ err: error }, "Unhandled error during execution");
        return {
          success: false,
          error: {
            type: "system",
            message: error.message || "Unknown error occurred",
          },
        };
      }
    },
    {
      body: t.Object({
        code: t.String(),
        files: t.Optional(
          t.Array(
            t.Object({
              filename: t.String(),
              b64_data: t.String(),
            }),
          ),
        ),
      }),
      query: t.Object({
        sessionId: t.String(),
      }),
    },
  )
  .get("/health", () => ({
    status: "healthy",
    activeSessions: sessionManager.getActiveSessionCount(),
  }))
  .get("/sessions", () => ({
    sessions: sessionManager.getSessionsInfo(),
  }))
  .listen(config.port);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "vivarium is running",
);

const handleShutdown = async (signal: string) => {
  logger.info({ signal }, "Starting graceful shutdown");

  const shutdownTimeout = setTimeout(() => {
    logger.fatal(
      { gracefulTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
      "Graceful shutdown timed out, forcing exit",
    );
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

  try {
    if (app.server) {
      logger.info("Stopping new connections");
      await app.stop();
      logger.info("Server stopped");
    }

    logger.info("Shutting down session manager");
    await sessionManager.shutdown();
    logger.info("Session manager shutdown complete");

    clearTimeout(shutdownTimeout);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    logger.fatal({ err: error }, "Error during graceful shutdown");
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
