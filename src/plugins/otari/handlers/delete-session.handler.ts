import { Elysia } from "elysia";
import type { SessionManager } from "../../../service/session-manager";

export function createDeleteSessionHandler(sessionManager: SessionManager) {
  return new Elysia({ name: "otari-delete-session-handler" })
    .delete("/sessions/:session_id", async ({ params, set }) => {
      await sessionManager.removeOtariSession(params.session_id);
      set.status = 204;
      return new Response(null, { status: 204 });
    });
}
