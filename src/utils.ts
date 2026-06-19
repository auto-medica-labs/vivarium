/**
 * Calculate the decoded byte size of a base64-encoded string without decoding.
 */
export function getBase64ByteSize(base64: string): number {
  let padding = 0;
  if (base64.endsWith("==")) padding = 2;
  else if (base64.endsWith("=")) padding = 1;
  return (base64.length * 3) / 4 - padding;
}

/** Parse an integer from an environment variable, returning a default if unset. */
export function getEnvInt(name: string, defaultValue: number): number {
  const val = process.env[name];
  if (val === undefined || val === "") return defaultValue;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 0) {
    throw new Error(
      `Environment variable ${name} must be a non-negative integer, got: ${val}`,
    );
  }
  return parsed;
}

/** Read a string environment variable with a fallback default. */
export function getEnvString(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

/** Read a boolean environment variable ("1" / "true" → true). */
export function getEnvBool(name: string, defaultValue: boolean): boolean {
  const val = process.env[name];
  if (val === undefined || val === "") return defaultValue;
  return val === "1" || val === "true";
}

/**
 * Simple promise-based semaphore for limiting concurrency.
 * Guards a shared resource (e.g., Pyodide worker initialization)
 * so only {@link max} callers are active at a time.
 */
export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.current--;
    }
  }
}
