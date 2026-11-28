import type { ManagedSession, SessionManager } from "../../service/session-manager";
import { WorkspaceFileError } from "../../service/types";

export class ProtocolError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

export function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProtocolError(422, "Request body must be valid JSON");
  }
}

export function validateRelativePath(value: unknown, allowDot = false): string {
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

export function requireOtariSession(
  manager: SessionManager,
  id: string,
): ManagedSession {
  const session = manager.lookupLiveOtariSession(id);
  if (!session) throw new ProtocolError(404, "Unknown or expired session");
  if (session.executing) throw new ProtocolError(409, "Session has an execution in progress");
  manager.touchOtariSession(session);
  return session;
}

export function mapWorkspaceError(error: unknown): never {
  if (error instanceof WorkspaceFileError) {
    if (error.code === "invalid") throw new ProtocolError(403, error.message);
    if (error.code === "is_directory") throw new ProtocolError(400, error.message);
    throw new ProtocolError(404, error.message);
  }
  throw error;
}

