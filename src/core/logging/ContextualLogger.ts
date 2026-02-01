/**
 * Contextual Logger with structured output.
 *
 * Provides structured logging with:
 * - Automatic context enrichment (correlationId, step, timestamp)
 * - Child loggers via withContext()
 * - Level filtering
 * - Error handling with AppError support
 *
 * @module
 */

import { ScaffoldError } from "../errors/errors.js";
import type { Step } from "./Step.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Log levels in order of severity.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * A structured log entry.
 */
export interface LogEntry {
  /** ISO timestamp */
  ts: string;

  /** Log level */
  level: LogLevel;

  /** Log message */
  msg: string;

  /** Correlation ID for tracing */
  correlationId?: string;

  /** Current pipeline step */
  step?: string;

  /** Error code (if logging an error) */
  errorCode?: string;

  /** Error message (if logging an error) */
  errorMessage?: string;

  /** Stack trace (debug mode only) */
  stack?: string;

  /** Error cause message (debug mode only) */
  cause?: string;

  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Log sink interface for output.
 */
export interface LogSink {
  write(entry: LogEntry): void;
}

/**
 * Context that can be bound to a logger.
 */
export interface LogContext {
  correlationId?: string;
  step?: Step;
  [key: string]: unknown;
}

/**
 * Options for creating a logger.
 */
export interface CreateLoggerOptions {
  /** Output sink (default: stdout JSON) */
  sink?: LogSink;

  /** Minimum log level (default: "info") */
  minLevel?: LogLevel;

  /** Include debug details (stack, cause) */
  debug?: boolean;

  /** Initial context */
  context?: LogContext;
}

// =============================================================================
// Log Level Utilities
// =============================================================================

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

// =============================================================================
// Default Sink
// =============================================================================

/**
 * Default sink that writes JSON to stdout.
 */
class StdoutJsonSink implements LogSink {
  write(entry: LogEntry): void {
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}

// =============================================================================
// ContextualLogger Class
// =============================================================================

/**
 * Logger with bound context and structured output.
 *
 * @example
 * ```typescript
 * const logger = createLogger({ minLevel: "info" });
 * const stepLogger = logger.withContext({ correlationId: "abc", step: Step.RENDER });
 * stepLogger.info("Rendering templates", { count: 5 });
 * ```
 */
export class ContextualLogger {
  private readonly sink: LogSink;
  private readonly minLevel: LogLevel;
  private readonly debugMode: boolean;
  private readonly context: LogContext;

  constructor(options: CreateLoggerOptions = {}) {
    this.sink = options.sink ?? new StdoutJsonSink();
    this.minLevel = options.minLevel ?? "info";
    this.debugMode = options.debug ?? false;
    this.context = options.context ?? {};
  }

  /**
   * Creates a child logger with additional context.
   *
   * @param ctx - Context to add
   * @returns New logger with merged context
   */
  withContext(ctx: LogContext): ContextualLogger {
    return new ContextualLogger({
      sink: this.sink,
      minLevel: this.minLevel,
      debug: this.debugMode,
      context: { ...this.context, ...ctx },
    });
  }

  /**
   * Logs a debug message.
   */
  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.log("debug", msg, ctx);
  }

  /**
   * Logs an info message.
   */
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.log("info", msg, ctx);
  }

  /**
   * Logs a warning message.
   */
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.log("warn", msg, ctx);
  }

  /**
   * Logs an error message.
   */
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.log("error", msg, ctx);
  }

  /**
   * Internal log method.
   */
  private log(
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>
  ): void {
    if (!shouldLog(level, this.minLevel)) {
      return;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
    };

    // Add bound context
    if (this.context.correlationId) {
      entry.correlationId = this.context.correlationId;
    }
    if (this.context.step) {
      entry.step = this.context.step;
    }

    // Add additional bound context (excluding reserved keys)
    for (const [key, value] of Object.entries(this.context)) {
      if (key !== "correlationId" && key !== "step" && value !== undefined) {
        entry[key] = value;
      }
    }

    // Add call-site context
    if (ctx) {
      for (const [key, value] of Object.entries(ctx)) {
        if (key === "error" && value instanceof Error) {
          this.enrichWithError(entry, value);
        } else if (value !== undefined) {
          entry[key] = value;
        }
      }
    }

    this.sink.write(entry);
  }

  /**
   * Enriches log entry with error information.
   */
  private enrichWithError(entry: LogEntry, error: Error): void {
    if (error instanceof ScaffoldError) {
      entry.errorCode = error.code;
      entry.errorMessage = error.message;

      if (this.debugMode) {
        if (error.stack) {
          entry.stack = error.stack;
        }
        if (error.cause) {
          entry.cause =
            error.cause instanceof Error
              ? error.cause.message
              : String(error.cause);
        }
      }
    } else {
      entry.errorMessage = error.message;

      if (this.debugMode && error.stack) {
        entry.stack = error.stack;
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new contextual logger.
 *
 * @param options - Logger options
 * @returns New logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({ minLevel: "debug", debug: true });
 * logger.info("Starting execution");
 * ```
 */
export function createLogger(options: CreateLoggerOptions = {}): ContextualLogger {
  return new ContextualLogger(options);
}
