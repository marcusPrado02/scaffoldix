/**
 * CLI Spinner module for Scaffoldix.
 *
 * Provides spinner functionality with:
 * - TTY detection with graceful fallback
 * - Integration with CliUx for consistent messaging
 * - Async operation wrapper for clean usage
 *
 * @module
 */

import * as clack from "@clack/prompts";
import { CliUx } from "./CliUx.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a CliSpinner instance.
 */
export interface CliSpinnerOptions {
  /** CliUx instance for messaging */
  readonly ux: CliUx;

  /** Override TTY detection (for testing) */
  readonly isTTY?: boolean;
}

// =============================================================================
// CliSpinner Class
// =============================================================================

/**
 * CLI spinner with TTY fallback.
 *
 * In TTY mode, uses @clack/prompts spinner for animated feedback.
 * In non-TTY mode (CI, pipes), falls back to simple text output.
 *
 * @example
 * ```typescript
 * const spinner = createCliSpinner({ ux });
 *
 * // Manual control
 * spinner.start("Loading manifest");
 * spinner.succeed("Manifest loaded");
 *
 * // Wrap async operation
 * const result = await spinner.wrap("Installing", async () => {
 *   return await installPack();
 * });
 * ```
 */
export class CliSpinner {
  private readonly ux: CliUx;
  private readonly isTTY: boolean;
  private clackSpinner: ReturnType<typeof clack.spinner> | null = null;
  private isRunning = false;
  private currentMessage = "";

  constructor(options: CliSpinnerOptions) {
    this.ux = options.ux;
    this.isTTY = options.isTTY ?? process.stdout.isTTY ?? false;
  }

  /**
   * Starts the spinner with a message.
   */
  start(message: string): void {
    this.currentMessage = message;
    this.isRunning = true;

    if (this.isTTY) {
      this.clackSpinner = clack.spinner();
      this.clackSpinner.start(message);
    } else {
      // Non-TTY fallback: simple info message
      this.ux.info(message);
    }
  }

  /**
   * Updates the spinner message.
   */
  update(message: string): void {
    this.currentMessage = message;

    if (this.isTTY && this.clackSpinner) {
      this.clackSpinner.message(message);
    } else if (this.isRunning) {
      // Non-TTY fallback: output new message
      this.ux.info(message);
    }
  }

  /**
   * Stops the spinner without a status message.
   */
  stop(): void {
    if (this.isTTY && this.clackSpinner) {
      this.clackSpinner.stop();
    }
    this.isRunning = false;
    this.clackSpinner = null;
  }

  /**
   * Stops the spinner with a success message.
   */
  succeed(message?: string): void {
    const finalMessage = message ?? this.currentMessage;

    if (this.isTTY && this.clackSpinner) {
      this.clackSpinner.stop(finalMessage);
    }

    // Always show success via ux for consistent output
    this.ux.success(finalMessage);

    this.isRunning = false;
    this.clackSpinner = null;
  }

  /**
   * Stops the spinner with a failure message.
   */
  fail(message?: string): void {
    const finalMessage = message ?? this.currentMessage;

    if (this.isTTY && this.clackSpinner) {
      this.clackSpinner.stop(finalMessage);
    }

    // Always show error via ux for consistent output
    this.ux.error(finalMessage);

    this.isRunning = false;
    this.clackSpinner = null;
  }

  /**
   * Wraps an async operation with spinner feedback.
   *
   * Automatically shows success on completion or failure on error.
   * Returns the result of the operation.
   * Rethrows any errors after showing failure.
   */
  async wrap<T>(message: string, operation: () => Promise<T>, successMessage?: string): Promise<T> {
    this.start(message);

    try {
      const result = await operation();
      this.succeed(successMessage ?? message);
      return result;
    } catch (error) {
      this.fail(message);
      throw error;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Creates a new CliSpinner instance.
 *
 * @param options - Configuration options
 * @returns CliSpinner instance
 */
export function createCliSpinner(options: CliSpinnerOptions): CliSpinner {
  return new CliSpinner(options);
}
