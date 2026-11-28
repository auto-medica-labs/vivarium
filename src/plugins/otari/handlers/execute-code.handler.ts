import { Elysia } from "elysia";
import { randomUUID } from "crypto";
import { AppError } from "../../../errors";
import { config } from "../../../config";
import { logger } from "../../../logger";
import { metrics } from "../../../metrics";
import type { SessionManager } from "../../../service/session-manager";
import { isRecord, ProtocolError, readJson } from "../protocol";

export function createExecuteCodeHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-execute-code-handler" })
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
    });
}
