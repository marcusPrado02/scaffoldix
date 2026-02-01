/**
 * CLI JSON output module for Scaffoldix.
 *
 * Provides utilities for formatting structured JSON output suitable for
 * automation and scripting. When --json mode is enabled, commands should
 * output clean JSON to stdout with no human-readable logs mixed in.
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Options for formatting JSON output.
 */
export interface JsonOutputOptions {
  /** Whether to add a trailing newline (default: false) */
  readonly trailingNewline?: boolean;
}

/**
 * Error details for JSON error output.
 */
export interface JsonErrorDetails {
  /** Error message */
  readonly message: string;

  /** Error code (optional) */
  readonly code?: string;

  /** Additional context to merge into error object */
  readonly context?: Record<string, unknown>;

  /** Stack trace (only included when debug is true) */
  readonly stack?: string;

  /** Whether to include debug info like stack traces */
  readonly debug?: boolean;
}

// =============================================================================
// Output Functions
// =============================================================================

/**
 * Formats data as a pretty-printed JSON string.
 *
 * The output is suitable for stdout in --json mode.
 * Uses 2-space indentation for readability.
 *
 * @param data - Data to serialize to JSON
 * @param options - Formatting options
 * @returns JSON string
 *
 * @example
 * ```typescript
 * const output = formatJsonOutput({ packs: [] });
 * // => '{\n  "packs": []\n}'
 * ```
 */
export function formatJsonOutput(data: unknown, options?: JsonOutputOptions): string {
  const json = JSON.stringify(data, null, 2);
  return options?.trailingNewline ? json + "\n" : json;
}

/**
 * Formats an error as a JSON string with error wrapper.
 *
 * The output follows a consistent schema:
 * ```json
 * {
 *   "error": {
 *     "message": "...",
 *     "code": "...",
 *     ...context fields...
 *   }
 * }
 * ```
 *
 * @param details - Error details
 * @param options - Formatting options
 * @returns JSON string with error object
 *
 * @example
 * ```typescript
 * const output = formatJsonError({
 *   message: "Pack not found",
 *   code: "PACK_NOT_FOUND",
 *   context: { packId: "foo" }
 * });
 * ```
 */
export function formatJsonError(details: JsonErrorDetails, options?: JsonOutputOptions): string {
  const errorObj: Record<string, unknown> = {
    message: details.message,
  };

  if (details.code) {
    errorObj.code = details.code;
  }

  // Merge context fields into error object
  if (details.context) {
    for (const [key, value] of Object.entries(details.context)) {
      errorObj[key] = value;
    }
  }

  // Only include stack trace in debug mode
  if (details.debug && details.stack) {
    errorObj.stack = details.stack;
  }

  const output = { error: errorObj };
  return formatJsonOutput(output, options);
}
