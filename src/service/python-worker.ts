import { loadPyodide, PyodideInterface } from "pyodide";
import { promises as fs } from "fs";
import * as path from "path";
import { CodeExecutionResponse } from "./types";

declare const self: Worker;

const pythonEnvironmentHomeDir = "/home/earth";
const defaultDirectoryOuterPath = "default_python_home";

// CVE-2026-5752 hardening: exposed objects must not inherit from
// Object.prototype, otherwise sandboxed Python can walk the prototype chain
// (.constructor.constructor) to reach host globalThis and escape.
function nullProto<T extends object>(props: T): T {
  return Object.assign(Object.create(null) as T, props);
}
function sealed<T extends object>(props: T): Readonly<T> {
  return Object.freeze(nullProto(props));
}
const noop = () => { /* DOM stub no-op */ };

// Functions expose Function.prototype.constructor, which is also a prototype
// chain escape route. Wrap host functions so the exposed proxy has a null
// prototype; the wrapped function still delegates to the real host impl.
function safeFn<T extends (...args: any[]) => any>(fn: T): T {
  const wrapped = (...args: Parameters<T>): ReturnType<T> => fn(...args);
  Object.setPrototypeOf(wrapped, null);
  return wrapped as T;
}

// Not frozen: matplotlib-pyodide writes to .id, .textContent, .style.display, etc.
const elementStub = () =>
  nullProto({
    addEventListener: safeFn(noop),
    style: nullProto({}),
    classList: sealed({ add: safeFn(noop), remove: safeFn(noop) }),
    setAttribute: safeFn(noop),
    appendChild: safeFn(noop),
    remove: safeFn(noop),
  });

let pyodide: PyodideInterface | null = null;
let out_string = "";
let err_string = "";
let default_files: any[] = [];
let default_file_names = new Set<string>();

async function readHostFileAsync(
  filePath: string,
): Promise<{ filename: string; data: Buffer }> {
  const buffer = await fs.readFile(filePath);
  return { filename: path.basename(filePath), data: buffer };
}

async function prepareEnvironment() {
  default_files = [];
  default_file_names = new Set();

  const files = await fs.readdir(defaultDirectoryOuterPath);
  const filePromises = files.map((file) => {
    const filePath = path.join(defaultDirectoryOuterPath, file);
    return readHostFileAsync(filePath);
  });
  const filesData = await Promise.all(filePromises);
  filesData.forEach(({ filename, data }) => {
    default_files.push({
      filename,
      byte_data: new Uint8Array(data),
    });
    default_file_names.add(filename);
  });

  // Pyodide 314+ emits this profiling file at runtime; don't return it as user output.
  default_file_names.add("default.profraw");
}

async function loadEnvironment(skipPackages = false): Promise<void> {
  out_string = "";
  err_string = "";
  pyodide = await loadPyodide({
    packageCacheDir: "pyodide_cache",
    stdout: (msg) => {
      out_string += msg + "\n";
    },
    stderr: (msg) => {
      err_string += msg + "\n";
    },
    jsglobals: nullProto({
      clearInterval: safeFn(clearInterval),
      clearTimeout: safeFn(clearTimeout),
      setInterval: safeFn(setInterval),
      setTimeout: safeFn(setTimeout),
      alert: safeFn(noop),
      // SECURITY (CVE-2026-5752): every value exposed to the sandbox must be
      // built with a null prototype so .constructor is unreachable.
      ImageData: sealed({}),
      document: sealed({
        getElementById: safeFn((id: any) => {
          if (id.includes("canvas")) return null;
          return elementStub();
        }),
        createElement: safeFn(() => elementStub()),
        createTextNode: safeFn(() => elementStub()),
        body: sealed({ appendChild: safeFn(noop) }),
      }),
    }),
    env: { HOME: pythonEnvironmentHomeDir },
  });

  // Write default files
  for (const f of default_files) {
    pyodide.FS.writeFile(
      pyodide.PATH.join2(pythonEnvironmentHomeDir, f.filename),
      f.byte_data,
    );
  }

  if (!skipPackages) {
    await pyodide.loadPackage(["numpy", "matplotlib", "pandas"]);

    await pyodide.runPythonAsync(
      "import matplotlib.pyplot as plt\nimport pandas as pd\nimport numpy as np",
    );
  }

  // SECURITY: disable dangerous filesystem backends; keep only MEMFS.
  delete (pyodide.FS.filesystems as any).NODEFS;
  delete (pyodide.FS.filesystems as any).WORKERFS;
  delete (pyodide.FS.filesystems as any).PROXYFS;

  // SECURITY: lock down package/module registration after initialization.
  (pyodide as any).loadPackage = async () => {
    throw new Error("Package installation is disabled");
  };
  if ("loadPackagesFromImports" in pyodide) {
    (pyodide as any).loadPackagesFromImports = async () => {
      throw new Error("Package installation is disabled");
    };
  }
  if ("registerJsModule" in pyodide) {
    (pyodide as any).registerJsModule = () => {
      throw new Error("JS module registration is disabled");
    };
  }
  if ("unregisterJsModule" in pyodide) {
    (pyodide as any).unregisterJsModule = () => {
      throw new Error("JS module registration is disabled");
    };
  }
}

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const entries = pyodide!.FS.readdir(dir);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === "." || entry === "..") continue;
    if (default_file_names.has(entry)) continue;

    const fullPath = pyodide!.PATH.join2(dir, entry);

    if (pyodide!.FS.isDir(pyodide!.FS.stat(fullPath).mode)) {
      files.push(...listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function readFileAsBase64(filePath: string): string {
  const fileData = pyodide!.FS.readFile(filePath, { encoding: "binary" });
  return bytesToBase64(fileData);
}

function bytesToBase64(bytes: Uint8Array): string {
  const binString = String.fromCodePoint(...bytes);
  return btoa(binString);
}

function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64);
  return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

function isValidFilename(name: string): boolean {
  return (
    !name.includes("..") &&
    !name.startsWith("/") &&
    !name.includes("\0") &&
    !/[\x00-\x1f]/.test(name)
  );
}

function getBase64ByteSize(b64: string): number {
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return (b64.length * 3) / 4 - padding;
}

async function runCode(
  code: string,
  files: { filename: string; b64_data: string }[],
  maxOutputFiles: number,
  maxOutputByteSize: number,
): Promise<CodeExecutionResponse> {
  out_string = "";
  err_string = "";
  const startCode = Date.now();
  const result: CodeExecutionResponse = { success: true };

  try {
    for (const f of files) {
      if (!isValidFilename(f.filename)) {
        throw new Error(`Invalid filename: ${f.filename}`);
      }
      const fileBytes = base64ToBytes(f.b64_data);
      pyodide!.FS.writeFile(
        pyodide!.PATH.join2(pythonEnvironmentHomeDir, f.filename),
        fileBytes,
      );
    }

    const interpreterResult = await pyodide!.runPythonAsync(code);

    const allFiles = listFilesRecursive(pythonEnvironmentHomeDir);
    const inputFileNames = new Set(files.map((f) => f.filename));

    const newFiles: { filename: string; b64_data: string }[] = [];
    let totalBytes = 0;

    for (const f of allFiles) {
      const relPath = f.slice(pythonEnvironmentHomeDir.length + 1);
      if (inputFileNames.has(relPath)) continue;
      if (newFiles.length >= maxOutputFiles) break;

      const b64 = readFileAsBase64(f);
      const byteSize = getBase64ByteSize(b64);
      if (totalBytes + byteSize > maxOutputByteSize) break;

      newFiles.push({ filename: relPath, b64_data: b64 });
      totalBytes += byteSize;
    }

    result.output_files = newFiles;
    result.final_expression = interpreterResult;
    result.success = true;
  } catch (error: any) {
    let errorMsg = error.toString();

    const lineMatch = errorMsg.match(/File "<exec>", line (\d+)/);
    if (lineMatch != null) {
      const lineNum = parseInt(lineMatch[1]);
      const codeLines = code.split("\n");
      const startLine = Math.max(1, lineNum - 4);
      const endLine = Math.min(codeLines.length, lineNum + 4);
      const codeContext = codeLines
        .slice(startLine - 1, endLine)
        .map((line, idx) => `${startLine + idx}: ${line}`)
        .join("\n");
      errorMsg = `${errorMsg}\n\nCode context:\n${codeContext}`;
    }

    result.error = { type: error.type || "execution", message: errorMsg };
    result.success = false;
  }

  result.std_out = out_string;
  result.std_err = err_string;
  result.code_runtime = Date.now() - startCode;
  return result;
}

self.onmessage = async (event) => {
  const { id, type, code, files, maxOutputFiles, maxOutputByteSize } = event.data;

  if (type === "init") {
    try {
      await prepareEnvironment();
      await loadEnvironment(event.data.skipPackages === true);
      self.postMessage({ id, type: "init", success: true });
    } catch (error: any) {
      self.postMessage({
        id,
        type: "init",
        success: false,
        error: error.message || String(error),
      });
    }
  } else if (type === "runCode") {
    const start = Date.now();
    try {
      const result = await runCode(
        code,
        files || [],
        maxOutputFiles ?? 100,
        maxOutputByteSize ?? 10 * 1024 * 1024,
      );
      self.postMessage({ id, type: "runCode", result });
    } catch (error: any) {
      self.postMessage({
        id,
        type: "runCode",
        result: {
          success: false,
          error: {
            type: "system",
            message: error.message || String(error),
          },
          std_out: out_string,
          std_err: err_string,
          code_runtime: Date.now() - start,
        } as CodeExecutionResponse,
      });
    }
  }
};
