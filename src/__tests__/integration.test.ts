import { beforeEach, afterEach, describe, expect, test } from "bun:test";

// Set environment before the app/config modules are evaluated.
process.env.MAX_SESSIONS = "3";
process.env.SESSION_TIMEOUT_MINUTES = "0.01";
process.env.EXECUTION_TIMEOUT_MS = "3000";
process.env.MAX_FILE_SIZE_BYTES = "50";
process.env.LOG_LEVEL = "fatal";

const { buildApp } = await import("../app");

describe("Vivarium integration", () => {
  let app: ReturnType<typeof buildApp>["app"];
  let rateLimiter: ReturnType<typeof buildApp>["rateLimiter"];
  let sessionManager: ReturnType<typeof buildApp>["sessionManager"];

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    rateLimiter = built.rateLimiter;
    sessionManager = built.sessionManager;
  });

  afterEach(async () => {
    await sessionManager.shutdown();
    rateLimiter.stop();
  });

  async function exec(
    sessionId: string,
    code: string,
    files?: { filename: string; b64_data: string }[],
  ) {
    const url = new URL("http://localhost/exec");
    url.searchParams.set("sessionId", sessionId);
    const res = await app.handle(
      new Request(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, files }),
      }),
    );
    return { res, body: (await res.json()) as any };
  }

  test("basic execution prints to stdout", async () => {
    const { res, body } = await exec("basic-test", "print('hello')");
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.std_out).toContain("hello");
  });

  test("expression result is returned", async () => {
    const { res, body } = await exec("expr-test", "2 + 2");
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.final_expression).toBe(4);
  });

  test("session expires and is removed", async () => {
    await exec("lifecycle-test", "x = 1");

    let list = await (await app.handle(new Request("http://localhost/sessions"))).json();
    expect(list.sessions.some((s: any) => s.id === "lifecycle-test")).toBe(true);

    // SESSION_TIMEOUT_MINUTES=0.01 → 600 ms
    await new Promise((r) => setTimeout(r, 750));
    await sessionManager.manualCleanup();

    list = await (await app.handle(new Request("http://localhost/sessions"))).json();
    expect(list.sessions.some((s: any) => s.id === "lifecycle-test")).toBe(false);
  });

  test("file upload and download", async () => {
    const b64 = Buffer.from("hello").toString("base64");
    const { res, body } = await exec("file-test", "with open('data.csv') as f: print(f.read())", [
      { filename: "data.csv", b64_data: b64 },
    ]);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.std_out).toContain("hello");
  });

  test("file count limit", async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      filename: `f${i}.txt`,
      b64_data: "YQ==",
    }));
    const { res, body } = await exec("limit-test", "pass", files);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("resource_limit");
  });

  test("file size limit", async () => {
    const big = Buffer.alloc(100).toString("base64");
    const { res, body } = await exec("size-test", "pass", [
      { filename: "big.bin", b64_data: big },
    ]);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("resource_limit");
  });

  test("execution timeout and session recovery", async () => {
    const { res, body } = await exec("timeout-test", "while True: pass");
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("timeout");

    const { res: res2, body: body2 } = await exec("timeout-test", "print('ok')");
    expect(res2.status).toBe(200);
    expect(body2.success).toBe(true);
    expect(body2.result.std_out).toContain("ok");
  });

  test("rate limiting", async () => {
    rateLimiter.reset();
    const statuses: number[] = [];

    for (let i = 0; i < 11; i++) {
      const res = await app.handle(
        new Request("http://localhost/exec?sessionId=rate-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "pass" }),
        }),
      );
      statuses.push(res.status);
    }

    const okCount = statuses.filter((s) => s === 200).length;
    const rateLimitedCount = statuses.filter((s) => s === 429).length;
    expect(okCount).toBe(10);
    expect(rateLimitedCount).toBe(1);
  });

  test(
    "session cap",
    async () => {
      for (let i = 0; i < 3; i++) {
        const { body } = await exec(`cap-${i}`, "pass");
        expect(body.success).toBe(true);
      }

      const { body } = await exec("cap-overflow", "pass");
      expect(body.success).toBe(false);
      expect(body.error.type).toBe("resource_limit");
    },
    60000,
  );

  test("missing sessionId returns validation error", async () => {
    const res = await app.handle(
      new Request("http://localhost/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "pass" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("validation");
  });

  test("python error returns the exception type", async () => {
    const { res, body } = await exec("error-test", "print(undefined_var)");
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error.type).toBe("NameError");
  });
});
