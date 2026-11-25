import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createOtariPlugin } from "../service/otari-plugin";
import { SessionManager } from "../service/session-manager";
import type { CodeExecutionResponse, PythonEnvironment, WorkspaceFileMetadata } from "../service/types";

describe("Otari code execution adapter", () => {
  let manager: SessionManager;
  let app: any;
  let lastTimeout: number | undefined;
  let releaseRun: (() => void) | undefined;

  beforeEach(() => {
    lastTimeout = undefined;
    releaseRun = undefined;
    const factory = (): PythonEnvironment => {
      const files = new Map<string, Uint8Array>();
      return {
        init: async () => {},
        waitForReady: async () => {},
        terminate: async () => {},
        cleanup: async () => {},
        runCode: async (code, _inputs, timeoutMs): Promise<CodeExecutionResponse> => {
          lastTimeout = timeoutMs;
          if (code === "wait") await new Promise<void>((resolve) => { releaseRun = resolve; });
          if (code === "crash") throw new Error("worker failed");
          if (code === "raise") {
            return { success: false, error: { type: "ValueError", message: "bad value" }, std_out: "before", std_err: "", code_runtime: 1 };
          }
          return { success: true, std_out: "ok", std_err: "", code_runtime: 1, output_files: [] };
        },
        listFiles: async (directory): Promise<WorkspaceFileMetadata[]> => {
          if (directory !== ".") return [];
          return [...files].map(([path, data]) => ({ path, size_bytes: data.byteLength, modified_at: 1 }));
        },
        readFile: async (path) => ({ data: files.get(path) ?? null, isDirectory: false }),
        writeFile: async (path, data) => { files.set(path, new Uint8Array(data)); },
      };
    };
    manager = new SessionManager(10, 3, factory, 1000);
    app = new Elysia().use(createOtariPlugin(manager));
  });

  afterEach(async () => {
    releaseRun?.();
    await manager.shutdown();
  });

  async function call(path: string, init?: RequestInit) {
    return app.handle(new Request(`http://localhost${path}`, init));
  }

  async function createSession() {
    const response = await call("/otari/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idle_timeout_seconds: 120, max_lifetime_seconds: 900, image: "ignored" }),
    });
    return { response, body: await response.json() as any };
  }

  async function postForm(path: string, form: FormData) {
    const request = new Request(`http://localhost${path}`, { method: "POST" });
    Object.defineProperty(request, "formData", { value: async () => form });
    return app.handle(request);
  }

  test("creates leases, rejects unknown sessions, and deletes idempotently", async () => {
    const { response, body } = await createSession();
    expect(response.status).toBe(201);
    expect(typeof body.session_id).toBe("string");
    expect(body.idle_timeout_seconds).toBe(120);
    expect(body.max_lifetime_seconds).toBe(900);
    expect(typeof body.created_at).toBe("number");
    expect(typeof body.last_activity_at).toBe("number");

    const missing = await call("/otari/sessions/unknown/exec", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "pass" } }),
    });
    expect(missing.status).toBe(404);
    expect(typeof (await missing.json() as any).detail).toBe("string");
    expect((await call(`/otari/sessions/${body.session_id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call(`/otari/sessions/${body.session_id}`, { method: "DELETE" })).status).toBe(204);
  });

  test("returns 503 and Retry-After at session capacity", async () => {
    await createSession();
    await createSession();
    await createSession();
    const fourth = await call("/otari/sessions", { method: "POST" });
    expect(fourth.status).toBe(503);
    expect((await fourth.json() as any).detail).toContain("temporarily unavailable");
    expect(fourth.headers.get("Retry-After")).toBe("1");
  });

  test("translates Python results, echoes ids, clamps timeout, and rejects unsupported tools", async () => {
    const { body: session } = await createSession();
    const url = `/otari/sessions/${session.session_id}/exec`;
    const generated = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "print(1)" }, timeout_seconds: 30 }),
    });
    const generatedBody = await generated.json() as any;
    expect(generated.status).toBe(200);
    expect(typeof generatedBody.tool_use_id).toBe("string");
    expect(generatedBody.result_block.tool_use_id).toBe(generatedBody.tool_use_id);
    expect(generatedBody.result_block.content.return_code).toBe(0);
    expect(lastTimeout).toBe(3000);

    const supplied = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "raise" }, tool_use_id: "call-7" }),
    });
    const suppliedBody = await supplied.json() as any;
    expect(supplied.status).toBe(200);
    expect(suppliedBody.tool_use_id).toBe("call-7");
    expect(suppliedBody.result_block.content.return_code).toBe(1);
    expect(suppliedBody.result_block.content.stderr).toContain("ValueError: bad value");

    const unsupported = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "bash_code_execution", input: { command: "pwd" } }),
    });
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json() as any).detail).toContain("Unsupported");

    const malformed = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: 4 } }),
    });
    expect(malformed.status).toBe(422);

    const unavailable = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "crash" } }),
    });
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json() as any).detail).toContain("worker was recovered");
  });

  test("rejects concurrent adapter execution with 409", async () => {
    const { body: session } = await createSession();
    const url = `/otari/sessions/${session.session_id}/exec`;
    const first = call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "wait" } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await call(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "code_execution", input: { code: "pass" } }),
    });
    expect(second.status).toBe(409);
    releaseRun?.();
    expect((await first).status).toBe(200);
  });

  test("uploads, lists and downloads binary files, while confining paths and size", async () => {
    const { body: session } = await createSession();
    const url = `/otari/sessions/${session.session_id}/files`;
    const form = new FormData();
    form.append("file", new File([new Uint8Array([0, 1, 255, 4])], "data.bin", { type: "application/octet-stream" }));
    const upload = await postForm(url, form);
    expect(upload.status).toBe(201);
    expect(await upload.json()).toEqual({ path: "data.bin", size_bytes: 4 });

    const listing = await call(`${url}/list`);
    expect(listing.status).toBe(200);
    expect((await listing.json() as any).files[0].path).toBe("data.bin");
    const download = await call(`${url}?path=data.bin`);
    expect(download.status).toBe(200);
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([0, 1, 255, 4]);

    const traversal = await call(`${url}?path=${encodeURIComponent("../secret")}`);
    expect(traversal.status).toBe(403);

    const tooLarge = new FormData();
    tooLarge.append("file", new File([new Uint8Array(51)], "large.bin"));
    expect((await postForm(url, tooLarge)).status).toBe(413);
  });
});
