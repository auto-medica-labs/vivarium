import { Elysia } from "elysia";
import { randomUUID } from "crypto";
import { AppError } from "../errors";
import { config } from "../config";
import { logger } from "../logger";
import { metrics } from "../metrics";
import { SessionManager, type ManagedSession } from "../service/session-manager";
import { WorkspaceFileError } from "../service/types";

class ProtocolError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProtocolError(422, "Request body must be valid JSON");
  }
}

function validateRelativePath(value: unknown, allowDot = false): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(422, "A non-empty relative path is required");
  }
  if (
    value.startsWith("/") || value.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.split("/").some((part) => part === "..")
  ) {
    throw new ProtocolError(403, "Path must stay within the session workspace");
  }
  const normalized = value.split("/").filter((part) => part !== "" && part !== ".").join("/");
  if (!normalized && !allowDot) {
    throw new ProtocolError(403, "Path must name a file within the session workspace");
  }
  return normalized || ".";
}

function requireOtariSession(
  manager: SessionManager,
  id: string,
): ManagedSession {
  const session = manager.lookupLiveOtariSession(id);
  if (!session) throw new ProtocolError(404, "Unknown or expired session");
  if (session.executing) throw new ProtocolError(409, "Session has an execution in progress");
  manager.touchOtariSession(session);
  return session;
}

function mapWorkspaceError(error: unknown): never {
  if (error instanceof WorkspaceFileError) {
    if (error.code === "invalid") throw new ProtocolError(403, error.message);
    if (error.code === "is_directory") throw new ProtocolError(400, error.message);
    throw new ProtocolError(404, error.message);
  }
  throw error;
}

function isValidOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1);
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
    })
    .delete("/sessions/:session_id", async ({ params, set }) => {
      await sessionManager.removeOtariSession(params.session_id);
      set.status = 204;
      return new Response(null, { status: 204 });
    })
    .post("/sessions/:session_id/exec", async ({ params, request }) => {
      const body = await readJson(request);
      if (!isRecord(body)) throw new ProtocolError(422, "Request body must be an object");
      if (typeof body.tool !== "string") throw new ProtocolError(422, "tool is required");
      if (body.tool !== "code_execution") {
        if (body.tool === "bash_code_execution" || body.tool === "text_editor_code_execution") {
          throw new ProtocolError(400, `Unsupported tool kind: ${body.tool}`);
        }
        throw new ProtocolError(400, `Unknown tool kind: ${body.tool}`);
      }
      if (!isRecord(body.input) || typeof body.input.code !== "string" || body.input.code.length === 0) {
        throw new ProtocolError(422, "input.code must be a non-empty string");
      }
      if (body.timeout_seconds !== undefined && !(typeof body.timeout_seconds === "number" && Number.isInteger(body.timeout_seconds) && body.timeout_seconds >= 1)) {
        throw new ProtocolError(422, "timeout_seconds must be a positive integer");
      }
      if (body.tool_use_id !== undefined && body.tool_use_id !== null && typeof body.tool_use_id !== "string") {
        throw new ProtocolError(422, "tool_use_id must be a string or null");
      }

      const claimed = sessionManager.acquireOtariExecution(params.session_id);
      if (claimed === "missing") throw new ProtocolError(404, "Unknown or expired session");
      if (claimed === "busy") throw new ProtocolError(409, "Session already has an execution in progress");

      const toolUseId = body.tool_use_id ?? `srvtoolu_${randomUUID()}`;
      const timeoutMs = Math.min(
        body.timeout_seconds == null ? config.executionTimeoutMs : body.timeout_seconds * 1000,
        config.executionTimeoutMs,
      );
      const start = Date.now();
      try {
        const result = await claimed.environment.runCode(body.input.code, [], timeoutMs, { changedFilesOnly: true });
        metrics.incRequests(result.success ? "success" : "error");
        metrics.observeDuration(result.code_runtime ?? (Date.now() - start));
        metrics.observeRequestDuration(Date.now() - start);
        const files = (result.output_files ?? []).map((file: any) => ({
          type: "code_execution_output",
          file_id: file.filename,
          filename: file.filename,
        }));
        const stderr = [result.std_err ?? "", result.success ? "" : `${result.error?.type ?? "PythonError"}: ${result.error?.message ?? "Execution failed"}`]
          .filter(Boolean).join("\n");
        return {
          tool_use_id: toolUseId,
          execution_time_ms: Date.now() - start,
          result_block: {
            type: "code_execution_tool_result",
            tool_use_id: toolUseId,
            content: {
              type: "code_execution_result",
              stdout: result.std_out ?? "",
              stderr,
              return_code: result.success ? 0 : 1,
              content: files,
            },
          },
        };
      } catch (error) {
        metrics.incRequests(error instanceof AppError && error.type === "timeout" ? "timeout" : "error");
        metrics.observeRequestDuration(Date.now() - start);
        logger.warn({ sessionId: claimed.id, errorType: error instanceof AppError ? error.type : "worker" }, "Otari execution could not complete");
        throw new ProtocolError(503, "Execution could not complete; the worker was recovered for future calls", 1);
      } finally {
        sessionManager.releaseOtariExecution(claimed);
      }
    })
    .get("/sessions/:session_id/files/list", async ({ params, query }) => {
      const session = requireOtariSession(sessionManager, params.session_id);
      const listPath = validateRelativePath(query.path ?? ".", true);
      if (!session.environment.listFiles) throw new ProtocolError(503, "Workspace file operations are unavailable");
      try {
        return { files: await session.environment.listFiles(listPath) };
      } catch (error) {
        mapWorkspaceError(error);
      }
    })
    .get("/sessions/:session_id/files", async ({ params, query, set }) => {
      const session = requireOtariSession(sessionManager, params.session_id);
      const filePath = validateRelativePath(query.path, false);
      if (!session.environment.readFile) throw new ProtocolError(503, "Workspace file operations are unavailable");
      try {
        const file = await session.environment.readFile(filePath);
        if (file.isDirectory) throw new ProtocolError(400, "Path names a directory, not a file");
        if (file.data === null) throw new ProtocolError(404, "File not found");
        const ext = filePath.split(".").pop()?.toLowerCase();
        const mimeTypes: Record<string, string> = {
          txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html",
          css: "text/css", js: "text/javascript", py: "text/x-python", png: "image/png",
          jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
          pdf: "application/pdf", zip: "application/zip",
        };
        set.headers["Content-Type"] = mimeTypes[ext ?? ""] ?? "application/octet-stream";
        set.headers["Content-Length"] = String(file.data.byteLength);
        const responseBytes = new ArrayBuffer(file.data.byteLength);
        new Uint8Array(responseBytes).set(file.data);
        return new Response(responseBytes, { status: 200, headers: { "Content-Type": mimeTypes[ext ?? ""] ?? "application/octet-stream" } });
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        mapWorkspaceError(error);
      }
    })
    .post("/sessions/:session_id/files", async ({ params, request, set }) => {
      const session = requireOtariSession(sessionManager, params.session_id);
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw new ProtocolError(422, "Expected multipart form data with a file field");
      }
      const file = form.get("file");
      if (!(file instanceof File)) throw new ProtocolError(422, "Multipart field 'file' is required");
      if (file.size > config.maxFileSizeBytes) {
        throw new ProtocolError(413, `File exceeds the ${config.maxFileSizeBytes} byte limit`);
      }
      const formPath = form.get("path");
      const chosenPath = typeof formPath === "string" && formPath.length > 0
        ? formPath
        : (file.name || "upload");
      const destination = validateRelativePath(chosenPath, false);
      if (!session.environment.writeFile) throw new ProtocolError(503, "Workspace file operations are unavailable");
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await session.environment.writeFile(destination, bytes);
      } catch (error) {
        mapWorkspaceError(error);
      }
      set.status = 201;
      return { path: destination, size_bytes: file.size };
    });
}
