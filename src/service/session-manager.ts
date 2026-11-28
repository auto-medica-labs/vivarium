import { randomUUID } from "crypto";
import { PyodidePythonEnvironment } from "./python-interpreter";
import { logger } from "../logger";
import { AppError } from "../errors";
import { config } from "../config";
import { metrics } from "../metrics";
import { Semaphore } from "../utils";
import type { PythonEnvironment } from "./types";

/** Factory signature for creating environments (injectable for tests). */
export type EnvironmentFactory = () => PythonEnvironment;

export interface ManagedSession {
  id: string;
  environment: PythonEnvironment;
  createdAt: number;
  lastAccessedAt: number;
  /** Null for legacy sessions, whose idle lease is sessionTimeoutMinutes. */
  idleTimeoutMs: number;
  maxLifetimeMs: number | null;
  otari: boolean;
  executing: boolean;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private pendingCreations = new Map<string, Promise<ManagedSession>>();
  private sessionTimeout: number;
  private maxSessions: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private otariCleanupInterval: NodeJS.Timeout | null = null;
  private readonly otariCleanupIntervalMs: number;
  private readonly initSemaphore: Semaphore;

  constructor(
    sessionTimeoutMinutes: number = 10,
    maxSessions: number = 20,
    private readonly environmentFactory?: EnvironmentFactory,
    otariCleanupIntervalMs: number = config.otariCleanupIntervalMs,
  ) {
    this.sessionTimeout = sessionTimeoutMinutes * 60 * 1000;
    this.maxSessions = maxSessions;
    this.otariCleanupIntervalMs = otariCleanupIntervalMs;
    this.initSemaphore = new Semaphore(config.maxConcurrentInits);
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      void this.cleanupExpiredSessions(false);
    }, 60 * 1000);
    this.otariCleanupInterval = setInterval(() => {
      void this.cleanupExpiredSessions(true);
    }, this.otariCleanupIntervalMs);
  }

  public stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.otariCleanupInterval) {
      clearInterval(this.otariCleanupInterval);
      this.otariCleanupInterval = null;
    }
  }

  private async initializeSession(
    sessionId: string,
    otari: boolean,
    idleTimeoutMs: number,
    maxLifetimeMs: number | null,
  ): Promise<ManagedSession> {
    logger.info({ sessionId, otari }, "Creating new session");
    await this.initSemaphore.acquire();
    let environment: PythonEnvironment | undefined;
    try {
      environment = this.environmentFactory
        ? this.environmentFactory()
        : new PyodidePythonEnvironment();
      const initStart = Date.now();
      await environment.init();
      metrics.observeInitDuration(Date.now() - initStart);
    } catch (error) {
      if (environment !== undefined) {
        try { await environment.terminate(); } catch { /* best effort */ }
      }
      throw error;
    } finally {
      this.initSemaphore.release();
    }

    if (environment === undefined) throw new Error("Environment factory did not create an environment");
    const now = Date.now();
    const session: ManagedSession = {
      id: sessionId,
      environment,
      createdAt: now,
      lastAccessedAt: now,
      idleTimeoutMs,
      maxLifetimeMs,
      otari,
      executing: false,
    };
    this.sessions.set(sessionId, session);
    logger.info({ sessionId, otari }, "Session created");
    return session;
  }

  private reserveCreation(
    sessionId: string,
    otari: boolean,
    idleTimeoutMs: number,
    maxLifetimeMs: number | null,
  ): Promise<ManagedSession> {
    if (this.sessions.has(sessionId) || this.pendingCreations.has(sessionId)) {
      throw new Error(`Session with id ${sessionId} already exists`);
    }
    if (this.sessions.size + this.pendingCreations.size >= this.maxSessions) {
      throw new AppError("resource_limit", "Maximum active sessions reached");
    }

    // Reserve the id and capacity synchronously before the first await. This
    // prevents parallel creates from overwriting each other or exceeding cap.
    const pending = this.initializeSession(sessionId, otari, idleTimeoutMs, maxLifetimeMs);
    this.pendingCreations.set(sessionId, pending);
    try {
      return pending;
    } finally {
      void pending.finally(() => {
        if (this.pendingCreations.get(sessionId) === pending) {
          this.pendingCreations.delete(sessionId);
        }
      }).catch(() => {});
    }
  }

  /** Creates a legacy session with its existing client-chosen id. */
  async createSession(sessionId: string): Promise<ManagedSession> {
    return this.reserveCreation(
      sessionId,
      false,
      this.sessionTimeout,
      null,
    );
  }

  /** Creates an Otari session with a server-generated opaque id and clamped leases. */
  async createOtariSession(
    idleTimeoutHintSeconds?: number | null,
    maxLifetimeHintSeconds?: number | null,
  ): Promise<ManagedSession> {
    const idleSeconds = Math.min(
      idleTimeoutHintSeconds ?? config.otariMaxIdleTimeoutSeconds,
      config.otariMaxIdleTimeoutSeconds,
    );
    const lifetimeSeconds = Math.min(
      maxLifetimeHintSeconds ?? config.otariMaxLifetimeSeconds,
      config.otariMaxLifetimeSeconds,
    );
    const sessionId = randomUUID();
    return this.reserveCreation(
      sessionId,
      true,
      idleSeconds * 1000,
      lifetimeSeconds * 1000,
    );
  }

  /** Legacy lookup that refreshes activity as before. */
  getSession(sessionId: string): ManagedSession | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = Date.now();
      return session;
    }
    return null;
  }

  /** Pure lookup: does not create a session or refresh its lease. */
  lookupSession(sessionId: string): ManagedSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Pure lookup restricted to adapter-created sessions. */
  lookupOtariSession(sessionId: string): ManagedSession | null {
    const session = this.sessions.get(sessionId);
    return session?.otari ? session : null;
  }

  lookupLiveOtariSession(sessionId: string): ManagedSession | null {
    const session = this.lookupOtariSession(sessionId);
    return session && !this.isSessionExpired(session) ? session : null;
  }

  /** Marks an adapter operation as activity after its session was verified. */
  touchOtariSession(session: ManagedSession): void {
    if (session.otari && this.sessions.get(session.id) === session) {
      session.lastAccessedAt = Date.now();
    }
  }

  /** Atomically claims the one execution slot for an Otari session. */
  acquireOtariExecution(sessionId: string): ManagedSession | "missing" | "busy" {
    const session = this.lookupOtariSession(sessionId);
    if (!session) return "missing";
    if (session.executing) return "busy";
    if (this.isSessionExpired(session)) return "missing";
    session.executing = true;
    this.touchOtariSession(session);
    return session;
  }

  releaseOtariExecution(session: ManagedSession): void {
    if (this.sessions.get(session.id) === session) {
      session.executing = false;
      session.lastAccessedAt = Date.now();
    }
  }

  async getOrCreateSession(sessionId: string): Promise<ManagedSession> {
    const existingSession = this.getSession(sessionId);
    if (existingSession) return existingSession;
    const pending = this.pendingCreations.get(sessionId);
    if (pending) return pending;
    return this.createSession(sessionId);
  }

  async removeSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
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

  async removeOtariSession(sessionId: string): Promise<boolean> {
    const session = this.lookupOtariSession(sessionId);
    return session ? this.removeSession(sessionId) : false;
  }

  private isSessionExpired(session: ManagedSession, now = Date.now()): boolean {
    const idleExpired = now - session.lastAccessedAt >= session.idleTimeoutMs;
    const lifetimeExpired = session.maxLifetimeMs !== null &&
      now - session.createdAt >= session.maxLifetimeMs;
    return idleExpired || lifetimeExpired;
  }

  private async cleanupExpiredSessions(otariOnly?: boolean): Promise<number> {
    const now = Date.now();
    const expiredSessions = Array.from(this.sessions.values())
      .filter((session) =>
        !session.executing &&
        (otariOnly === undefined || session.otari === otariOnly) &&
        this.isSessionExpired(session, now)
      )
      .map((session) => session.id);
    for (const sessionId of expiredSessions) await this.removeSession(sessionId);
    if (expiredSessions.length > 0) {
      logger.info({ expiredCount: expiredSessions.length }, "Cleaned up expired sessions");
    }
    return expiredSessions.length;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  isActive(): boolean {
    return this.cleanupInterval !== null;
  }

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
      ageMinutes: (now - session.createdAt) / 60000,
      idleMinutes: (now - session.lastAccessedAt) / 60000,
    }));
  }

  async manualCleanup(): Promise<number> {
    return this.cleanupExpiredSessions();
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down SessionManager");
    this.stopCleanupInterval();
    await Promise.allSettled(Array.from(this.pendingCreations.values()));
    for (const sessionId of Array.from(this.sessions.keys())) {
      await this.removeSession(sessionId);
    }
    logger.info("SessionManager shutdown complete");
  }
}
