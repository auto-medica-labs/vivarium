import { PyodidePythonEnvironment } from "./python-interpreter";
import { logger } from "../logger";
import { AppError } from "../errors";

interface Session {
  id: string;
  environment: PyodidePythonEnvironment;
  createdAt: number;
  lastAccessedAt: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionTimeout: number; // 10 minutes in milliseconds
  private maxSessions: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly cleanupIntervalMs: number = 60 * 1000; // Check every minute

  constructor(sessionTimeoutMinutes: number = 10, maxSessions: number = 20) {
    this.sessionTimeout = sessionTimeoutMinutes * 60 * 1000;
    this.maxSessions = maxSessions;
    this.startCleanupInterval();
  }

  /**
   * Starts the cleanup interval that periodically removes expired sessions
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.cleanupIntervalMs);
  }

  /**
   * Stops the cleanup interval
   */
  public stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Creates a new session with a Pyodide environment
   * @param sessionId - Unique identifier for the session
   * @returns The newly created session
   */
  async createSession(sessionId: string): Promise<Session> {
    // Check if session already exists
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session with id ${sessionId} already exists`);
    }

    if (this.sessions.size >= this.maxSessions) {
      throw new AppError(
        "resource_limit",
        "Maximum active sessions reached",
      );
    }

    logger.info({ sessionId }, "Creating new session");
    const environment = new PyodidePythonEnvironment();
    await environment.init();

    const session: Session = {
      id: sessionId,
      environment,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.sessions.set(sessionId, session);
    logger.info({ sessionId }, "Session created");
    return session;
  }

  /**
   * Gets an existing session and updates its last accessed time
   * @param sessionId - The session identifier
   * @returns The session if found, null otherwise
   */
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = Date.now();
      return session;
    }
    return null;
  }

  /**
   * Gets or creates a session
   * @param sessionId - The session identifier
   * @returns The session (existing or newly created)
   */
  async getOrCreateSession(sessionId: string): Promise<Session> {
    const existingSession = this.getSession(sessionId);
    if (existingSession) {
      return existingSession;
    }
    return await this.createSession(sessionId);
  }

  /**
   * Removes a specific session and cleans up its environment
   * @param sessionId - The session identifier
   * @returns true if session was removed, false if not found
   */
  async removeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    logger.info({ sessionId }, "Removing session");
    try {
      await session.environment.terminate();
    } catch (error) {
      logger.error({ sessionId, err: error }, "Error cleaning up session");
    }

    this.sessions.delete(sessionId);
    logger.info({ sessionId }, "Session removed");
    return true;
  }

  /**
   * Checks if a session has expired based on the timeout
   * @param session - The session to check
   * @returns true if session has expired, false otherwise
   */
  private isSessionExpired(session: Session): boolean {
    const now = Date.now();
    const timeSinceLastAccess = now - session.lastAccessedAt;
    return timeSinceLastAccess >= this.sessionTimeout;
  }

  /**
   * Removes all expired sessions
   * @returns The number of sessions that were cleaned up
   */
  private async cleanupExpiredSessions(): Promise<number> {
    const expiredSessions: string[] = [];

    // Find expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isSessionExpired(session)) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    if (expiredSessions.length > 0) {
      logger.info({ expiredCount: expiredSessions.length }, "Cleaning up expired sessions");
      for (const sessionId of expiredSessions) {
        await this.removeSession(sessionId);
      }
    }

    logger.info(
      { activeSessions: this.sessions.size },
      "Session cleanup cycle complete"
    );

    return expiredSessions.length;
  }

  /**
   * Gets the number of active sessions
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Gets information about all active sessions
   */
  getSessionsInfo(): Array<{
    id: string;
    createdAt: number;
    lastAccessedAt: number;
    ageMinutes: number;
    idleMinutes: number;
  }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      ageMinutes: (now - session.createdAt) / (60 * 1000),
      idleMinutes: (now - session.lastAccessedAt) / (60 * 1000),
    }));
  }

  /**
   * Manually trigger cleanup of expired sessions
   * @returns The number of sessions that were cleaned up
   */
  async manualCleanup(): Promise<number> {
    return await this.cleanupExpiredSessions();
  }

  /**
   * Removes all sessions and stops the cleanup interval
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down SessionManager");
    this.stopCleanupInterval();

    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.removeSession(sessionId);
    }

    logger.info("SessionManager shutdown complete");
  }
}
