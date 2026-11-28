import { Elysia } from "elysia";
import { AppError } from "../../../errors";
import { logger } from "../../../logger";
import type { SessionManager } from "../../../service/session-manager";
import { isRecord, ProtocolError, readJson } from "../protocol";

function isValidOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1);
}

export function createSessionHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-create-session-handler" })
    .post("/sessions", async ({ request, set }) => {
      let body: unknown = {};
      if (request.headers.get("content-length") !== "0" && request.body !== null) {
        body = await readJson(request);
      }
      if (!isRecord(body)) throw new ProtocolError(422, "Request body must be an object");
      if (body.image !== undefined && body.image !== null && typeof body.image !== "string") {
        throw new ProtocolError(422, "image must be a string or null");
      }
      if (typeof body.image === "string" && body.image.length > 255) {
        throw new ProtocolError(422, "image must be at most 255 characters");
      }
      if (!isValidOptionalPositiveInteger(body.idle_timeout_seconds)) {
        throw new ProtocolError(422, "idle_timeout_seconds must be a positive integer or null");
      }
      if (!isValidOptionalPositiveInteger(body.max_lifetime_seconds)) {
        throw new ProtocolError(422, "max_lifetime_seconds must be a positive integer or null");
      }
      try {
        const session = await sessionManager.createOtariSession(
          body.idle_timeout_seconds,
          body.max_lifetime_seconds,
        );
        set.status = 201;
        return {
          session_id: session.id,
          idle_timeout_seconds: session.idleTimeoutMs / 1000,
          max_lifetime_seconds: (session.maxLifetimeMs ?? 0) / 1000,
          created_at: session.createdAt / 1000,
          last_activity_at: session.lastAccessedAt / 1000,
        };
      } catch (error) {
        logger.warn({ errorType: error instanceof AppError ? error.type : "init" }, "Otari session creation unavailable");
        throw new ProtocolError(503, "Session creation is temporarily unavailable", 1);
      }
    });
}
