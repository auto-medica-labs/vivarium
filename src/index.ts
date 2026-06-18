import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { SessionManager } from "./service/session-manager";
import { PyodidePythonEnvironment } from "./service/python-interpreter";
import { config } from "./config";
import { logixlysiaIns, logger, createRequestLogger } from "./logger";
import { AppError } from "./errors";
import { metrics } from "./metrics";

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;
const READINESS_TIMEOUT_MS = 10000;

function getBase64ByteSize(base64: string): number {
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return (base64.length * 3) / 4 - padding;
}

class RateLimiter {
  private readonly windowMs = 60 * 1000;
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(private readonly limit: number) {
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  isAllowed(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = this.entries.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(ip, entry);
    }

    entry.count++;

    if (entry.count > this.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(0, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }
    return { allowed: true };
  }

  stop(): void {
    clearInterval(this.cleanupInterval);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries) {
      if (now > entry.resetAt) {
        this.entries.delete(ip);
      }
    }
  }
}

const rateLimiter = new RateLimiter(config.rateLimitRequestsPerMin);
const sessionManager = new SessionManager(
  config.sessionTimeoutMinutes,
  config.maxSessions,
);

const app = new Elysia()
  .onRequest(({ set, request, server }) => {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    set.headers["x-request-id"] = requestId;

    const path = new URL(request.url).pathname;
    if (path === "/health" || path === "/ready" || path === "/metrics") {
      return;
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      server?.requestIP?.(request)?.address ||
      "unknown";

    const { allowed, retryAfter } = rateLimiter.isAllowed(ip);
    if (!allowed) {
      logger.warn({ ip, path, retryAfter }, "Rate limit exceeded");
      if (path === "/exec") {
        metrics.incRequests("rate_limited");
        metrics.incExecutions();
      }
      set.status = 429;
      if (retryAfter !== undefined) {
        set.headers["Retry-After"] = String(retryAfter);
      }
      return {
        success: false,
        error: {
          type: "rate_limit",
          message: "Rate limit exceeded. Try again later.",
        },
      };
    }

    if (path === "/exec") {
      metrics.incExecutions();
    }
  })
  .onError(({ code, error, set, request }) => {
    const path = new URL(request.url).pathname;

    if (code === "VALIDATION") {
      if (path === "/exec") {
        metrics.incRequests("error");
      }
      set.status = 400;
      return {
        success: false,
        error: { type: "validation", message: error.message },
      };
    }

    if (error instanceof AppError) {
      set.status = error.statusCode;
      logger.warn(
        { errorType: error.type, statusCode: error.statusCode },
        "Application error",
      );
      if (path === "/exec") {
        const status = error.type === "timeout" ? "timeout" : "error";
        metrics.incRequests(status);
      }
      return {
        success: false,
        error: { type: error.type, message: error.message },
      };
    }

    logger.error({ err: error }, "Unhandled error");
    if (path === "/exec") {
      metrics.incRequests("error");
    }
    set.status = 500;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = config.isProduction
      ? "Internal server error"
      : errorMessage || "Unknown error";
    return {
      success: false,
      error: { type: "system", message },
    };
  })
  .use(logixlysiaIns)
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
        throw new AppError(
          "validation",
          "sessionId query parameter is required",
        );
      }

      if (files.length > config.maxFilesPerRequest) {
        reqLogger.warn(
          { fileCount: files.length, maxAllowed: config.maxFilesPerRequest },
          "Resource limit hit: too many files",
        );
        throw new AppError(
          "resource_limit",
          `Too many files. Maximum allowed is ${config.maxFilesPerRequest}, received ${files.length}`,
        );
      }

      for (const f of files) {
        const fileSize = getBase64ByteSize(f.b64_data);
        if (fileSize > config.maxFileSizeBytes) {
          reqLogger.warn(
            { filename: f.filename, fileSize, maxAllowed: config.maxFileSizeBytes },
            "Resource limit hit: file too large",
          );
          throw new AppError(
            "resource_limit",
            `File "${f.filename}" exceeds maximum size of ${config.maxFileSizeBytes} bytes`,
          );
        }
      }

      const session = await sessionManager.getOrCreateSession(sessionId);
      reqLogger.info(
        { sessionAgeMs: Date.now() - session.createdAt },
        "Session acquired",
      );

      const result = await session.environment.runCode(code, files);
      metrics.incRequests(result.success ? "success" : "error");
      if (result.code_runtime !== undefined) {
        metrics.observeDuration(result.code_runtime);
      }
      reqLogger.info(
        { success: result.success, runtimeMs: result.code_runtime },
        "Execution finished",
      );

      if (!result.success) {
        reqLogger.warn({ errorType: result.error?.type }, "Execution failed");
        return result;
      }

      return { success: true, result };
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
  .get("/ready", async ({ set }) => {
    const env = new PyodidePythonEnvironment();
    try {
      await Promise.race([
        env.init({ skipPackages: true }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Readiness check timed out")),
            READINESS_TIMEOUT_MS,
          ),
        ),
      ]);

      const result = await Promise.race([
        env.runCode("1 + 1", []),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Readiness check timed out")),
            READINESS_TIMEOUT_MS,
          ),
        ),
      ]);

      if (result.success && result.final_expression === 2) {
        set.status = 200;
        return { status: "ready" };
      }

      set.status = 503;
      return { status: "not_ready" };
    } catch (error) {
      logger.warn({ err: error }, "Readiness check failed");
      set.status = 503;
      return { status: "not_ready" };
    } finally {
      await env.terminate();
    }
  })
  .get("/sessions", () => ({
    sessions: sessionManager.getSessionsInfo(),
  }))
  .get("/metrics", ({ set }) => {
    set.headers["Content-Type"] = "text/plain";
    return metrics.render(sessionManager.getActiveSessionCount());
  })
  .listen(config.port);

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
