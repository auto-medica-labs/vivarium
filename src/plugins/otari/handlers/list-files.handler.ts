import { Elysia } from "elysia";
import type { SessionManager } from "../../../service/session-manager";
import { mapWorkspaceError, requireOtariSession, validateRelativePath } from "../protocol";

export function createListFilesHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-list-files-handler" })
    .get("/sessions/:session_id/files/list", async ({ params, query }) => {
      const session = requireOtariSession(sessionManager, params.session_id);
      const listPath = validateRelativePath(query.path ?? ".", true);
      try {
        return { files: await session.environment.listFiles(listPath) };
      } catch (error) {
        mapWorkspaceError(error);
      }
    });
}
