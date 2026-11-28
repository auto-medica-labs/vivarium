export interface CodeExecutionResponse {
  success: boolean;
  final_expression?: any;
  output_files?: any[];
  error?: {
    type: string;
    message: string;
  };
  std_out?: string;
  std_err?: string;
  code_runtime?: number;
}

export interface FileData {
  filename: string;
  data: Buffer;
}

export interface PythonEnvironment {
  init(options?: { skipPackages?: boolean }): Promise<void>;
  waitForReady(): Promise<void>;
  runCode(code: string, files: any[], timeoutMs?: number, options?: { changedFilesOnly?: boolean }): Promise<CodeExecutionResponse>;
  listFiles(path: string): Promise<WorkspaceFileMetadata[]>;
  readFile(path: string): Promise<{ data: Uint8Array | null; isDirectory: boolean }>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  cleanup(): Promise<void>;
  terminate(): Promise<void>;
}

export interface WorkspaceFileMetadata {
  path: string;
  size_bytes: number;
  mime_type?: string;
  modified_at?: number;
}

export class WorkspaceFileError extends Error {
  constructor(public readonly code: "not_found" | "not_directory" | "is_directory" | "invalid", message: string) {
    super(message);
    this.name = "WorkspaceFileError";
  }
}
