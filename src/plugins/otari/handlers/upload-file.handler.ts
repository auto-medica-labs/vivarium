import { Elysia } from "elysia";
import { config } from "../../../config";
import type { SessionManager } from "../../../service/session-manager";
import { mapWorkspaceError, ProtocolError, requireOtariSession, validateRelativePath } from "../protocol";

export function createUploadFileHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-upload-file-handler" })
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
