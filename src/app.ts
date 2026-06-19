import { Elysia, t } from "elysia";
import { randomUUID } from "crypto";
import { access } from "fs/promises";
import { constants } from "fs";
import { SessionManager } from "./service/session-manager";
import { config } from "./config";
import { logixlysiaIns, logger, createRequestLogger } from "./logger";
import { AppError } from "./errors";
import { metrics } from "./metrics";
import { getBase64ByteSize } from "./utils";
import { RateLimiter } from "./rate-limiter";

export function buildApp() {
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

      // Determine client IP, respecting trusted proxy count.
      // When trustedProxyCount === 0 (default), X-Forwarded-For is ignored
      // entirely to prevent spoofing. When N > 0, the Nth-from-right IP in
      // the chain is trusted as the client.
      let ip: string;
      if (config.trustedProxyCount > 0) {
        const forwardedFor = request.headers.get("x-forwarded-for");
        if (forwardedFor) {
          const ips = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
          const clientIndex = ips.length - config.trustedProxyCount - 1;
          if (clientIndex >= 0 && clientIndex < ips.length) {
            ip = ips[clientIndex];
          } else {
            ip = server?.requestIP?.(request)?.address || "unknown";
          }
        } else {
          ip = server?.requestIP?.(request)?.address || "unknown";
        }
      } else {
        // No trusted proxy — use direct connection only
        ip = server?.requestIP?.(request)?.address || "unknown";
      }

      const { allowed, retryAfter } = rateLimiter.isAllowed(ip);
      if (!allowed) {
        logger.warn({ ip, path, retryAfter }, "Rate limit exceeded");
        set.status = 429;
        if (retryAfter !== undefined) {
          set.headers["Retry-After"] = String(retryAfter);
        }
        throw new AppError(
          "rate_limit",
          "Rate limit exceeded. Try again later.",
        );
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
          if (error.type === "timeout") {
            metrics.incRequests("timeout");
          } else if (error.type === "rate_limit") {
            metrics.incRequests("rate_limited");
            metrics.incExecutions();
          } else {
            metrics.incRequests("error");
          }
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
        const requestStart = Date.now();
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
          if (
            f.filename.includes("..") ||
            f.filename.startsWith("/") ||
            f.filename.includes("\0") ||
            /[\x00-\x1f]/.test(f.filename)
          ) {
            reqLogger.warn(
              { filename: f.filename },
              "Invalid filename rejected",
            );
            throw new AppError(
              "validation",
              `Invalid filename: ${f.filename}`,
            );
          }

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
        metrics.observeRequestDuration(Date.now() - requestStart);
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
    .get("/health", async () => {
      const sessionManagerActive = sessionManager.isActive();

      // Check pyodide cache is accessible (quick file-system check,
      // doesn't boot a worker).
      let cacheAvailable = false;
      try {
        await access("pyodide_cache", constants.R_OK);
        cacheAvailable = true;
      } catch {
        // cache not found or not readable
      }

      return {
        status: "healthy",
        activeSessions: sessionManager.getActiveSessionCount(),
        sessionManagerRunning: sessionManagerActive,
        pyodideCacheAvailable: cacheAvailable,
      };
    })
    .get("/ready", ({ set }) => {
      set.status = 200;
      return { status: "ready" };
    })
    .get("/sessions", () => ({
      sessions: sessionManager.getSessionsInfo(),
    }))
    .get("/metrics", ({ set }) => {
      set.headers["Content-Type"] = "text/plain";
      return metrics.render(sessionManager.getActiveSessionCount());
    });

  return { app, rateLimiter, sessionManager };
}
