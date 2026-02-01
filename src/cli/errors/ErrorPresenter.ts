/**
 * Error presentation for CLI output.
 *
 * Formats ScaffoldError and unknown errors into user-friendly,
 * actionable CLI output. Never leaks stack traces by default.
 *
 * @module
 */

import { ScaffoldError } from "../../core/errors/errors.js";
import { ErrorCode } from "../../core/errors/ErrorCode.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for error formatting.
 */
export interface FormatErrorOptions {
  /** Include stack traces and cause chain (default: false) */
  debug?: boolean;
}

/**
 * Options for ErrorPresenter.
 */
export interface ErrorPresenterOptions {
  /** Output function (default: console.error) */
  output?: (line: string) => void;
  /** Include stack traces and cause chain */
  debug?: boolean;
}

// =============================================================================
// ErrorPresenter Class
// =============================================================================

/**
 * Presents errors to CLI users in a friendly format.
 */
export class ErrorPresenter {
  private readonly output: (line: string) => void;
  private readonly debug: boolean;

  constructor(options: ErrorPresenterOptions = {}) {
    this.output = options.output ?? console.error;
    this.debug = options.debug ?? false;
  }

  /**
   * Presents an error to the user.
   */
  present(error: unknown): void {
    const formatted = formatError(error, { debug: this.debug });
    for (const line of formatted.split("\n")) {
      this.output(line);
    }
  }
}

// =============================================================================
// Format Functions
// =============================================================================

/**
 * Formats an error for CLI output.
 *
 * For ScaffoldError: shows code, message, hints, and details.
 * For unknown errors: wraps as INTERNAL_ERROR.
 * Stack traces only shown in debug mode.
 */
export function formatError(error: unknown, options: FormatErrorOptions = {}): string {
  const { debug = false } = options;

  // Normalize to ScaffoldError
  const scaffoldError = normalizeError(error);

  const lines: string[] = [];

  // Title line: Error [CODE]: message
  lines.push(`Error [${scaffoldError.code}]: ${scaffoldError.message}`);
  lines.push("");

  // Details (if present)
  if (scaffoldError.details && Object.keys(scaffoldError.details).length > 0) {
    const detailLines = formatDetails(scaffoldError.details);
    if (detailLines.length > 0) {
      lines.push(...detailLines);
      lines.push("");
    }
  }

  // Hint (if present)
  if (scaffoldError.hint) {
    lines.push("Hint:");
    for (const hintLine of scaffoldError.hint.split("\n")) {
      lines.push(`  ${hintLine}`);
    }
    lines.push("");
  }

  // Debug info (stack trace and cause)
  if (debug) {
    if (scaffoldError.stack) {
      lines.push("Stack trace:");
      // Skip the first line (it's the error message)
      const stackLines = scaffoldError.stack.split("\n").slice(1);
      for (const stackLine of stackLines) {
        lines.push(stackLine);
      }
      lines.push("");
    }

    if (scaffoldError.cause) {
      lines.push("Caused by:");
      const causeError =
        scaffoldError.cause instanceof Error
          ? scaffoldError.cause
          : new Error(String(scaffoldError.cause));
      lines.push(`  ${causeError.message}`);
      if (causeError.stack) {
        const causeStackLines = causeError.stack.split("\n").slice(1);
        for (const stackLine of causeStackLines) {
          lines.push(stackLine);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Normalizes any error into a ScaffoldError.
 */
function normalizeError(error: unknown): ScaffoldError {
  if (error instanceof ScaffoldError) {
    return error;
  }

  if (error instanceof Error) {
    const scaffoldError = new ScaffoldError(
      error.message,
      ErrorCode.INTERNAL_ERROR,
      undefined,
      undefined,
      undefined,
      error,
      false, // programming error
    );
    scaffoldError.stack = error.stack;
    return scaffoldError;
  }

  return new ScaffoldError(
    String(error),
    ErrorCode.INTERNAL_ERROR,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  );
}

/**
 * Formats error details for display.
 */
function formatDetails(details: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(details)) {
    if (Array.isArray(value)) {
      // Special handling for arrays (e.g., conflictingFiles, errors)
      if (value.length > 0) {
        lines.push(`${formatKey(key)}:`);
        for (const item of value) {
          lines.push(`  - ${String(item)}`);
        }
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${formatKey(key)}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${formatKey(key)}: ${String(value)}`);
    }
  }

  return lines;
}

/**
 * Formats a camelCase key for display.
 */
function formatKey(key: string): string {
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}
