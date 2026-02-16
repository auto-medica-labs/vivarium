import { Elysia, t } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { SessionManager } from "./service/session-manager";

const sessionManager = new SessionManager();
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

const app = new Elysia()
  .use(openapi())
  .post(
    "/exec",
    async ({ body, query }) => {
      const { code, files = [] } = body;
      const { sessionId } = query;

      if (!sessionId) {
        return {
          success: false,
          error: {
            type: "validation",
            message: "sessionId query parameter is required",
          },
        };
      }

      try {
        const session = await sessionManager.getOrCreateSession(sessionId);
        const environment = session.environment;

        const result = await environment.runCode(code, files);

        return {
          success: true,
          result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: {
            type: "execution",
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
  .listen(3080);

console.log(
  `vivarium is running at ${app.server?.hostname}:${app.server?.port}`,
);

const handleShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    console.error(
      `Graceful shutdown timed out after ${GRACEFUL_SHUTDOWN_TIMEOUT_MS}ms. Forcing exit.`,
    );
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

  try {
    if (app.server) {
      console.log("Stopping new connections...");
      await app.stop();
      console.log("Server stopped accepting new connections");
    }

    console.log("Shutting down session manager...");
    await sessionManager.shutdown();
    console.log("Session manager shutdown complete");

    clearTimeout(shutdownTimeout);

    console.log("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
