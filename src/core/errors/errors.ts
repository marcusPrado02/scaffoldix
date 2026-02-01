export class ScaffoldError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
    public readonly data?: Record<string, unknown>,
    public readonly hint?: string,
    public readonly cause?: Error,
    public readonly isOperational: boolean = true,
    public readonly timestamp: Date = new Date(),
  ) {
    super(message);
    this.name = "ScaffoldError";
  }
}

export function toUserMessage(err: unknown): { message: string; code?: string } {
  if (err instanceof ScaffoldError) {
    return { message: err.message, code: err.code };
  } else if (err instanceof Error) {
    return { message: err.message };
  } else {
    return { message: String(err) };
  }
}
