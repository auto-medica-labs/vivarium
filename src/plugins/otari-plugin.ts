import { Elysia } from "elysia";
import { AppError } from "../errors";
import { config } from "../config";
import { logger } from "../logger";
import type { SessionManager } from "../service/session-manager";
import { createSessionHandler } from "./otari/handlers/create-session.handler";
import { createDeleteSessionHandler } from "./otari/handlers/delete-session.handler";
import { createExecuteCodeHandler } from "./otari/handlers/execute-code.handler";
import { createListFilesHandler } from "./otari/handlers/list-files.handler";
import { createReadFileHandler } from "./otari/handlers/read-file.handler";
import { createUploadFileHandler } from "./otari/handlers/upload-file.handler";
import { ProtocolError } from "./otari/protocol";

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Otari protocol v1 adapter. Mount this plugin on the main Elysia app. */
export function createOtariPlugin(
  sessionManager: SessionManager,
  routePrefix: string = config.otariRoutePrefix,
) {
  return new Elysia({ name: "otari-code-execution", prefix: routePrefix })
    .onError(({ error, set }) => {
      if (error instanceof ProtocolError) {
        set.status = error.status;
        if (error.retryAfter !== undefined) set.headers["Retry-After"] = String(error.retryAfter);
        return { detail: error.message };
      }
      if (error instanceof AppError) {
        set.status = error.type === "resource_limit" ? 503 : error.statusCode;
        return { detail: error.message };
      }
      if ((error as any)?.code === "VALIDATION" || (error as any)?.code === "PARSE") {
        set.status = 422;
        return { detail: errorDetail(error) };
      }
      logger.error({ err: error }, "Otari adapter operation failed");
      set.status = 503;
      return { detail: "Code execution backend is temporarily unavailable" };
    })
    .use(createSessionHandler(sessionManager))
    .use(createDeleteSessionHandler(sessionManager))
    .use(createExecuteCodeHandler(sessionManager))
    .use(createListFilesHandler(sessionManager))
    .use(createReadFileHandler(sessionManager))
    .use(createUploadFileHandler(sessionManager));
}
