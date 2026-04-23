import { CodeExecutionResponse, PythonEnvironment } from "./types";
import { config } from "../config";

function getBase64ByteSize(base64: string): number {
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return (base64.length * 3) / 4 - padding;
}

export class PyodidePythonEnvironment implements PythonEnvironment {
  private worker: Worker | null = null;
  private workerUrl: URL;
  private messageId = 0;

  constructor() {
    this.workerUrl = new URL("./python-worker.ts", import.meta.url);
  }

  private async sendMessage<T>(type: string, payload: any): Promise<T> {
    if (!this.worker) {
      throw new Error("Worker is not initialized");
    }

    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      let settled = false;

      const onMessage = (event: MessageEvent) => {
        if (event.data.id !== id || event.data.type !== type) return;
        if (settled) return;
        settled = true;
        cleanup();
        resolve(event.data);
      };

      const onError = (error: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Worker error: ${error.message}`));
      };

      const cleanup = () => {
        this.worker!.removeEventListener("message", onMessage);
        this.worker!.removeEventListener("error", onError);
      };

      this.worker!.addEventListener("message", onMessage);
      this.worker!.addEventListener("error", onError);
      this.worker!.postMessage({ id, type, ...payload });
    });
  }

  async init(): Promise<void> {
    this.worker = new Worker(this.workerUrl);
    const response = await this.sendMessage<{
      success: boolean;
      error?: string;
    }>("init", {});
    if (!response.success) {
      throw new Error(response.error || "Worker initialization failed");
    }
  }

  async waitForReady(): Promise<void> {
    if (!this.worker) {
      await this.init();
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  async cleanup(): Promise<void> {
    await this.terminate();
    await this.init();
  }

  async runCode(
    code: string,
    files: { filename: string; b64_data: string }[],
  ): Promise<CodeExecutionResponse> {
    const startCode = Date.now();

    // Validate file count
    if (files.length > config.maxFilesPerRequest) {
      return {
        success: false,
        error: {
          type: "resource_limit",
          message: `Too many files. Maximum allowed is ${config.maxFilesPerRequest}, received ${files.length}`,
        },
        std_out: "",
        std_err: "",
        code_runtime: Date.now() - startCode,
      };
    }

    // Validate files before sending to worker
    for (const f of files) {
      if (f.filename == undefined || f.b64_data == undefined) {
        return {
          success: false,
          error: {
            type: "parsing",
            message: "file data is missing for: " + JSON.stringify(f),
          },
          std_out: "",
          std_err: "",
          code_runtime: Date.now() - startCode,
        };
      }

      const fileSize = getBase64ByteSize(f.b64_data);
      if (fileSize > config.maxFileSizeBytes) {
        return {
          success: false,
          error: {
            type: "resource_limit",
            message: `File "${f.filename}" exceeds maximum size of ${config.maxFileSizeBytes} bytes`,
          },
          std_out: "",
          std_err: "",
          code_runtime: Date.now() - startCode,
        };
      }
    }

    if (!this.worker) {
      await this.init();
    }

    const runPromise = this.sendMessage<{ result: CodeExecutionResponse }>(
      "runCode",
      { code, files },
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("EXECUTION_TIMEOUT")),
        config.executionTimeoutMs,
      ),
    );

    try {
      const response = await Promise.race([runPromise, timeoutPromise]);
      return response.result;
    } catch (error: any) {
      if (error.message === "EXECUTION_TIMEOUT") {
        // Hard kill the worker and respawn
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        await this.init();

        return {
          success: false,
          error: {
            type: "timeout",
            message: `Execution timed out after ${config.executionTimeoutMs}ms`,
          },
          std_out: "",
          std_err: "",
          code_runtime: config.executionTimeoutMs,
        };
      }

      // Unexpected worker error — respawn for future requests
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      await this.init();

      return {
        success: false,
        error: {
          type: "system",
          message: error.message || "Unknown worker error",
        },
        std_out: "",
        std_err: "",
        code_runtime: Date.now() - startCode,
      };
    }
  }
}
