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

  test("/ready returns 200 quickly without booting Pyodide", async () => {
    const res = await app.handle(new Request("http://localhost/ready"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
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

  test(
    "CVE-2026-5752 prototype-chain escape is blocked",
    async () => {
      const code = `
import js

# Object mocks exposed via jsglobals must not inherit from Object.prototype.
doc = js.document
assert getattr(doc, "constructor", None) is None, (
    "CVE-2026-5752 regression: js.document.constructor is reachable"
)
try:
    leak = doc.constructor.constructor("return globalThis")()
    raise AssertionError(f"escaped: {leak}")
except (AttributeError, TypeError):
    pass

# Wrapped host functions must also hide Function.prototype.constructor.
for name in ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "alert"]:
    fn = getattr(js, name)
    assert getattr(fn, "constructor", None) is None, (
        f"prototype escape route via {name}.constructor"
    )

print("ok: prototype chain escape blocked")
`;
      const { res, body } = await exec("cve-test", code);
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain("ok: prototype chain escape blocked");
    },
    30000,
  );

  test(
    "js proxy root and nested functions hide constructor",
    async () => {
      const code = `
import js

# Root jsglobals object must not inherit Object.prototype.
assert getattr(js, "constructor", None) is None, "js.constructor is reachable"
assert getattr(js, "__proto__", None) is None, "js.__proto__ is reachable"

# Nested DOM functions must also hide Function.prototype.constructor.
doc = js.document
for name in ["getElementById", "createElement", "createTextNode"]:
    fn = getattr(doc, name)
    assert getattr(fn, "constructor", None) is None, (
        f"nested function {name}.constructor is reachable"
    )

# Element stub methods must hide constructor as well.
el = doc.createElement("div")
assert getattr(el.addEventListener, "constructor", None) is None
assert getattr(el.setAttribute, "constructor", None) is None

print("ok: js root and nested functions locked")
`;
      const { res, body } = await exec("js-root-test", code);
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain(
        "ok: js root and nested functions locked",
      );
    },
    30000,
  );

  test(
    "package installation is disabled",
    async () => {
      const code = `
import pyodide
try:
    await pyodide.loadPackage("six")
    print("LOAD_ALLOWED")
except Exception as e:
    print("LOAD_BLOCKED:", "disabled" in str(e).lower() or "package" in str(e).lower())
`;
      const { res, body } = await exec("package-blocked-test", code);
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain("LOAD_BLOCKED: True");
    },
    30000,
  );

  test(
    "dangerous filesystem backends are disabled",
    async () => {
      const code = `
from pyodide_js import FS
keys = list(FS.filesystems.object_keys())
print("NODEFS:", "NODEFS" in keys)
print("WORKERFS:", "WORKERFS" in keys)
print("PROXYFS:", "PROXYFS" in keys)
print("MEMFS:", "MEMFS" in keys)
`;
      const { res, body } = await exec("fs-backend-test", code);
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain("NODEFS: False");
      expect(body.result.std_out).toContain("WORKERFS: False");
      expect(body.result.std_out).toContain("PROXYFS: False");
      expect(body.result.std_out).toContain("MEMFS: True");
    },
    30000,
  );

  test(
    "matplotlib still initializes after DOM hardening",
    async () => {
      const { res, body } = await exec("mpl-test", "import matplotlib.pyplot as plt\nplt.subplots()\nprint('matplotlib ok')");
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.result.std_out).toContain("matplotlib ok");
    },
    30000,
  );
});
