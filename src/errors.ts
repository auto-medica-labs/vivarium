const STATUS_BY_TYPE = {
  validation: 400,
  resource_limit: 413,
  timeout: 504,
  system: 500,
  rate_limit: 429,
  parsing: 400,
} as const;

export type AppErrorType = keyof typeof STATUS_BY_TYPE;

export class AppError extends Error {
  public readonly statusCode: number;

  constructor(
    public readonly type: AppErrorType,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = STATUS_BY_TYPE[type];
  }
}
