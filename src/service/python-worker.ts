import { loadPyodide, PyodideInterface } from "pyodide";
import { promises as fs } from "fs";
import * as path from "path";
import { CodeExecutionResponse } from "./types";

declare const self: Worker;

const pythonEnvironmentHomeDir = "/home/earth";
const defaultDirectoryOuterPath = "default_python_home";

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
    jsglobals: {
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
      ImageData: {},
      document: {
        getElementById: (id: any) => {
          if (id.includes("canvas")) return null;
          return {
            addEventListener: () => {},
            style: {},
            classList: { add: () => {}, remove: () => {} },
            setAttribute: () => {},
            appendChild: () => {},
            remove: () => {},
          };
        },
        createElement: () => ({
          addEventListener: () => {},
          style: {},
          classList: { add: () => {}, remove: () => {} },
          setAttribute: () => {},
          appendChild: () => {},
          remove: () => {},
        }),
        createTextNode: () => ({
          addEventListener: () => {},
          style: {},
          classList: { add: () => {}, remove: () => {} },
          setAttribute: () => {},
          appendChild: () => {},
          remove: () => {},
        }),
        body: {
          appendChild: () => {},
        },
      },
    },
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

async function runCode(
  code: string,
  files: { filename: string; b64_data: string }[],
): Promise<CodeExecutionResponse> {
  out_string = "";
  err_string = "";
  const startCode = Date.now();
  const result: CodeExecutionResponse = { success: true };

  try {
    await pyodide!.loadPackagesFromImports(code);

    for (const f of files) {
      const fileBytes = base64ToBytes(f.b64_data);
      pyodide!.FS.writeFile(
        pyodide!.PATH.join2(pythonEnvironmentHomeDir, f.filename),
        fileBytes,
      );
    }

    const interpreterResult = await pyodide!.runPythonAsync(code);

    const allFiles = listFilesRecursive(pythonEnvironmentHomeDir);
    const inputFileNames = new Set(files.map((f) => f.filename));

    const newFiles = allFiles
      .filter(
        (f) =>
          !inputFileNames.has(f.slice(pythonEnvironmentHomeDir.length + 1)),
      )
      .map((f) => ({
        filename: f.slice(pythonEnvironmentHomeDir.length + 1),
        b64_data: readFileAsBase64(f),
      }));

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
  const { id, type, code, files } = event.data;

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
      const result = await runCode(code, files || []);
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
