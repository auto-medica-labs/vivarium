import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { SessionManager, EnvironmentFactory } from "../service/session-manager";
import type { PythonEnvironment, CodeExecutionResponse } from "../service/types";

function makeMockEnv(): PythonEnvironment {
  return {
    init: async () => {},
    waitForReady: async () => {},
    terminate: async () => {},
    cleanup: async () => {},
    runCode: async (_code: string, _files: any[]): Promise<CodeExecutionResponse> => ({
      success: true,
      std_out: "",
      std_err: "",
      code_runtime: 0,
    }),
  };
}

/** Tracks whether a mock environment was terminated. */
function makeTrackedEnv(terminated: { current: boolean }): PythonEnvironment {
  return {
    init: async () => {},
    waitForReady: async () => {},
    terminate: async () => { terminated.current = true; },
    cleanup: async () => {},
    runCode: async (_code: string, _files: any[]): Promise<CodeExecutionResponse> => ({
      success: true,
      std_out: "",
      std_err: "",
      code_runtime: 0,
    }),
  };
}

describe("SessionManager", () => {
  let sm: SessionManager;
  let factory: EnvironmentFactory;

  afterEach(async () => {
    await sm.shutdown();
  });

  test("creates a session and can retrieve it", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    const session = await sm.getOrCreateSession("test-1");
    expect(session.id).toBe("test-1");

    const retrieved = sm.getSession("test-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("test-1");
  });

  test("getOrCreateSession returns existing session", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    const s1 = await sm.getOrCreateSession("dup");
    const s2 = await sm.getOrCreateSession("dup");
    expect(s1).toBe(s2);
  });

  test("getSession returns null for non-existent session", () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    expect(sm.getSession("nope")).toBeNull();
  });

  test("getSession updates lastAccessedAt", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    await sm.getOrCreateSession("t");

    const before = sm.getSession("t")!.lastAccessedAt;
    await new Promise((r) => setTimeout(r, 5));
    const after = sm.getSession("t")!.lastAccessedAt;
    expect(after).toBeGreaterThan(before);
  });

  test("removeSession calls terminate and removes the session", async () => {
    const terminated = { current: false };
    factory = () => makeTrackedEnv(terminated);
    sm = new SessionManager(10, 5, factory);

    await sm.getOrCreateSession("remove-me");
    const removed = await sm.removeSession("remove-me");
    expect(removed).toBe(true);
    expect(terminated.current).toBe(true);
    expect(sm.getSession("remove-me")).toBeNull();
  });

  test("removeSession on non-existent session returns false", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    expect(await sm.removeSession("ghost")).toBe(false);
  });

  test("enforces max sessions cap", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 3, factory);

    await sm.getOrCreateSession("a");
    await sm.getOrCreateSession("b");
    await sm.getOrCreateSession("c");

    try {
      await sm.getOrCreateSession("d");
      expect.unreachable("Should have thrown resource_limit");
    } catch (err: any) {
      expect(err.type).toBe("resource_limit");
    }
  });

  test("session expires after timeout", async () => {
    factory = makeMockEnv;
    // 1 ms timeout (converted from minutes: 0.00002 minutes ≈ 1.2 ms)
    const timeoutMinutes = 0.00002;
    sm = new SessionManager(timeoutMinutes, 5, factory);

    await sm.getOrCreateSession("expiry-test");
    // Session should exist now
    expect(sm.getSession("expiry-test")).not.toBeNull();

    // Wait for expiry (timeout is ~1.2 ms, wait 50 ms to be safe)
    await new Promise((r) => setTimeout(r, 50));
    await sm.manualCleanup();

    expect(sm.getSession("expiry-test")).toBeNull();
  });

  test("shutdown terminates all sessions", async () => {
    const terminatedA = { current: false };
    const terminatedB = { current: false };
    const envs = [terminatedA, terminatedB];
    let idx = 0;
    factory = () => makeTrackedEnv(envs[idx++]);
    sm = new SessionManager(10, 5, factory);

    await sm.getOrCreateSession("a");
    await sm.getOrCreateSession("b");
    expect(sm.getActiveSessionCount()).toBe(2);

    await sm.shutdown();
    expect(sm.getActiveSessionCount()).toBe(0);
    expect(terminatedA.current).toBe(true);
    expect(terminatedB.current).toBe(true);
  });

  test("getSessionsInfo returns correct metadata", async () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);

    await sm.getOrCreateSession("info-test");
    const info = sm.getSessionsInfo();
    expect(info.length).toBe(1);
    expect(info[0].id).toBe("info-test");
    expect(info[0].ageMinutes).toBeGreaterThanOrEqual(0);
    expect(info[0].idleMinutes).toBeGreaterThanOrEqual(0);
  });

  test("isActive returns true while cleanup interval is running", () => {
    factory = makeMockEnv;
    sm = new SessionManager(10, 5, factory);
    expect(sm.isActive()).toBe(true);
    sm.stopCleanupInterval();
    expect(sm.isActive()).toBe(false);
  });
});
