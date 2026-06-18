import { buildApp } from "./app";
import { config } from "./config";
import { logger } from "./logger";

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

const { app, rateLimiter, sessionManager } = buildApp();

app.listen(config.port);

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  "vivarium is running",
);

const handleShutdown = async (signal: string) => {
  logger.info({ signal }, "Starting graceful shutdown");

  rateLimiter.stop();

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
