export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export class Logger {
  constructor(private readonly minLevel: LogLevel = "info") {}

  private order: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  canLog(level: LogLevel): boolean {
    return this.order[level] >= this.order[this.minLevel];
  }

  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    data?: Record<string, unknown>,
  ): void {
    if (!this.canLog(level)) return;

    const record: LogRecord = {
      level,
      message,
      timestamp: new Date(),
      context,
      data,
    };

    process.stdout.write(JSON.stringify(record) + "\n");
  }

  debug(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void {
    this.write("debug", message, context, data);
  }

  info(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void {
    this.write("info", message, context, data);
  }

  warn(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void {
    this.write("warn", message, context, data);
  }

  error(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void {
    this.write("error", message, context, data);
  }
}
