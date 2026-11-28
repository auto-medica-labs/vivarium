import { Elysia } from "elysia";
import type { SessionManager } from "../../../service/session-manager";
import { mapWorkspaceError, ProtocolError, requireOtariSession, validateRelativePath } from "../protocol";

export function createReadFileHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-read-file-handler" })
    .get("/sessions/:session_id/files", async ({ params, query, set }) => {
      const session = requireOtariSession(sessionManager, params.session_id);
      const filePath = validateRelativePath(query.path, false);
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
        return new Response(responseBytes, {
          status: 200,
          headers: { "Content-Type": mimeTypes[ext ?? ""] ?? "application/octet-stream" },
        });
      } catch (error) {
        if (error instanceof ProtocolError) throw error;
        mapWorkspaceError(error);
      }
    });
}
