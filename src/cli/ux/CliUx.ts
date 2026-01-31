/**
 * CLI UX module for Scaffoldix.
 *
 * Provides consistent, user-friendly messaging with:
 * - Color-coded output (success/error/warning)
 * - Log levels (silent, info, verbose, debug)
 * - Formatted output with emojis and structure
 * - TTY detection for CI fallback
 *
 * @module
 */

import pc from "picocolors";

// =============================================================================
// Types
// =============================================================================

/**
 * Log levels from least to most verbose.
 */
export type LogLevel = "silent" | "info" | "verbose" | "debug";

/**
 * Options for creating a CliUx instance.
 */
export interface CliUxOptions {
  /** Log level threshold */
  readonly level: LogLevel;

  /** Whether to use colors (auto-detected from TTY if not specified) */
  readonly colors?: boolean;

  /** Custom stdout writer (for testing) */
  readonly stdout?: (msg: string) => void;

  /** Custom stderr writer (for testing) */
  readonly stderr?: (msg: string) => void;
}

/**
 * Details for success messages.
 */
export interface SuccessDetails {
  readonly [key: string]: unknown;
}

/**
 * Details for error messages.
 */
export interface ErrorDetails {
  readonly code?: string;
  readonly hint?: string;
  readonly [key: string]: unknown;
}

// =============================================================================
// Constants
// =============================================================================

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  info: 1,
  verbose: 2,
  debug: 3,
};

// Symbols
const SYMBOLS = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "→",
  step: "●",
};

// =============================================================================
// CliUx Class
// =============================================================================

/**
 * CLI UX helper for consistent, beautiful messaging.
 *
 * @example
 * ```typescript
 * const ux = createCliUx({ level: "info" });
 *
 * ux.success("Pack installed", { name: "foo", version: "1.0.0" });
 * ux.error("File not found", { hint: "Check the path" });
 * ux.warn("Deprecated feature");
 * ux.step(1, 3, "Loading manifest");
 * ```
 */
export class CliUx {
  private readonly level: LogLevel;
  private readonly useColors: boolean;
  private readonly writeStdout: (msg: string) => void;
  private readonly writeStderr: (msg: string) => void;

  constructor(options: CliUxOptions) {
    this.level = options.level;
    this.useColors = options.colors ?? process.stdout.isTTY ?? false;
    this.writeStdout = options.stdout ?? ((msg) => process.stdout.write(msg));
    this.writeStderr = options.stderr ?? ((msg) => process.stderr.write(msg));
  }

  // ===========================================================================
  // Level checking
  // ===========================================================================

  private canLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[this.level];
  }

  // ===========================================================================
  // Color helpers
  // ===========================================================================

  private green(text: string): string {
    return this.useColors ? pc.green(text) : text;
  }

  private red(text: string): string {
    return this.useColors ? pc.red(text) : text;
  }

  private yellow(text: string): string {
    return this.useColors ? pc.yellow(text) : text;
  }

  private cyan(text: string): string {
    return this.useColors ? pc.cyan(text) : text;
  }

  private dim(text: string): string {
    return this.useColors ? pc.dim(text) : text;
  }

  private bold(text: string): string {
    return this.useColors ? pc.bold(text) : text;
  }

  // ===========================================================================
  // Output methods
  // ===========================================================================

  /**
   * Outputs a success message with checkmark.
   */
  success(message: string, details?: SuccessDetails): void {
    if (!this.canLog("info")) return;

    const symbol = this.green(SYMBOLS.success);
    this.writeStdout(`${symbol} ${message}\n`);

    if (details) {
      for (const [key, value] of Object.entries(details)) {
        this.writeStdout(`  ${this.dim(key + ":")} ${value}\n`);
      }
    }
  }

  /**
   * Outputs an error message with X mark.
   * Always shown regardless of log level.
   */
  error(message: string, details?: ErrorDetails): void {
    const symbol = this.red(SYMBOLS.error);
    const code = details?.code ? `${this.red(details.code)}: ` : "";

    this.writeStderr(`${symbol} ${code}${message}\n`);

    if (details?.hint) {
      this.writeStderr(`  ${this.dim("Hint:")} ${details.hint}\n`);
    }
  }

  /**
   * Outputs a warning message with warning symbol.
   */
  warn(message: string): void {
    if (!this.canLog("info")) return;

    const symbol = this.yellow(SYMBOLS.warning);
    this.writeStderr(`${symbol} ${message}\n`);
  }

  /**
   * Outputs an info message with arrow.
   */
  info(message: string): void {
    if (!this.canLog("info")) return;

    const symbol = this.cyan(SYMBOLS.info);
    this.writeStdout(`${symbol} ${message}\n`);
  }

  /**
   * Outputs a verbose message (only shown at verbose+ level).
   */
  verbose(message: string): void {
    if (!this.canLog("verbose")) return;

    this.writeStdout(`  ${this.dim(message)}\n`);
  }

  /**
   * Outputs a debug message (only shown at debug level).
   */
  debug(message: string): void {
    if (!this.canLog("debug")) return;

    this.writeStdout(`  ${this.dim(`[debug] ${message}`)}\n`);
  }

  /**
   * Outputs a numbered step.
   */
  step(current: number, total: number, description: string): void {
    if (!this.canLog("info")) return;

    const prefix = this.dim(`[${current}/${total}]`);
    this.writeStdout(`${prefix} ${description}\n`);
  }

  /**
   * Outputs an indented detail line.
   */
  detail(message: string): void {
    if (!this.canLog("info")) return;

    this.writeStdout(`  ${message}\n`);
  }

  /**
   * Outputs a blank line.
   */
  newline(): void {
    if (!this.canLog("info")) return;

    this.writeStdout("\n");
  }

  /**
   * Outputs a header line.
   */
  header(title: string): void {
    if (!this.canLog("info")) return;

    this.writeStdout(`\n${this.bold(title)}\n`);
  }

  /**
   * Outputs a list item.
   */
  listItem(text: string): void {
    if (!this.canLog("info")) return;

    this.writeStdout(`  • ${text}\n`);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Creates a new CliUx instance.
 *
 * @param options - Configuration options
 * @returns CliUx instance
 */
export function createCliUx(options: CliUxOptions): CliUx {
  return new CliUx(options);
}

/**
 * Default CliUx instance with info level.
 */
let defaultInstance: CliUx | null = null;

/**
 * Gets or creates the default CliUx instance.
 */
export function getCliUx(): CliUx {
  if (!defaultInstance) {
    defaultInstance = createCliUx({ level: "info" });
  }
  return defaultInstance;
}

/**
 * Sets the default CliUx instance.
 */
export function setDefaultCliUx(ux: CliUx): void {
  defaultInstance = ux;
}

// =============================================================================
// Log Level Parsing
// =============================================================================

/**
 * Options for parsing log level from CLI flags.
 */
export interface LogLevelFlags {
  /** Whether --verbose flag is set */
  readonly verbose: boolean;

  /** Whether --debug flag is set */
  readonly debug: boolean;

  /** Whether --silent flag is set */
  readonly silent: boolean;
}

/**
 * Parses log level from CLI flags.
 *
 * Priority (highest to lowest):
 * 1. debug (always wins - for troubleshooting)
 * 2. silent (suppresses all output except errors)
 * 3. verbose (shows additional context)
 * 4. info (default)
 *
 * @param flags - CLI flag values
 * @returns Appropriate log level
 */
export function parseLogLevel(flags: LogLevelFlags): LogLevel {
  if (flags.debug) {
    return "debug";
  }
  if (flags.silent) {
    return "silent";
  }
  if (flags.verbose) {
    return "verbose";
  }
  return "info";
}
