/**
 * Hook Runner - Executes shell commands as lifecycle hooks.
 *
 * This module provides a way to run shell commands (like npm install, build scripts)
 * as part of the scaffolding lifecycle. Commands are executed sequentially in the
 * target directory.
 *
 * ## Features
 *
 * - Sequential execution in manifest order
 * - Shell mode for complex commands (pipes, redirects, etc.)
 * - Visible stdout/stderr output
 * - Duration tracking for each command
 * - Actionable error messages on failure
 *
 * @module
 */

import { execa, type Options as ExecaOptions } from "execa";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for hook execution.
 */
export interface HookLogger {
  /** Log informational messages */
  info(message: string): void;

  /** Log error messages */
  error(message: string): void;

  /** Log command output (stdout) */
  stdout?(line: string): void;

  /** Log command output (stderr) */
  stderr?(line: string): void;
}

/**
 * Parameters for running postGenerate hooks.
 */
export interface RunHooksParams {
  /** Array of shell command strings to execute */
  readonly commands: readonly string[];

  /** Working directory for command execution (usually targetDir) */
  readonly cwd: string;

  /** Optional environment variables to merge with process.env */
  readonly env?: Record<string, string>;

  /** Logger for output */
  readonly logger: HookLogger;
}

/**
 * Result of a single hook execution.
 */
export interface HookResult {
  /** The command that was executed */
  readonly command: string;

  /** Whether the command succeeded */
  readonly success: boolean;

  /** Exit code (0 for success) */
  readonly exitCode: number;

  /** Duration in milliseconds */
  readonly durationMs: number;

  /** Error message if failed */
  readonly error?: string;
}

/**
 * Summary of all hook executions.
 */
export interface HookRunSummary {
  /** Total number of hooks */
  readonly total: number;

  /** Number of hooks that succeeded */
  readonly succeeded: number;

  /** Number of hooks that failed */
  readonly failed: number;

  /** Whether all hooks completed successfully */
  readonly success: boolean;

  /** Total duration in milliseconds */
  readonly totalDurationMs: number;

  /** Individual hook results */
  readonly results: HookResult[];
}

// =============================================================================
// HookRunner Class
// =============================================================================

/**
 * Executes shell commands as lifecycle hooks.
 *
 * @example
 * ```typescript
 * const runner = new HookRunner();
 *
 * const summary = await runner.runPostGenerate({
 *   commands: ["npm install", "npm run build"],
 *   cwd: "/path/to/project",
 *   logger: console,
 * });
 *
 * if (!summary.success) {
 *   console.error("Hooks failed!");
 * }
 * ```
 */
export class HookRunner {
  /**
   * Runs postGenerate hooks sequentially.
   *
   * @param params - Commands, cwd, and logger
   * @returns Summary of hook executions
   * @throws ScaffoldError if any hook fails
   */
  async runPostGenerate(params: RunHooksParams): Promise<HookRunSummary> {
    const { commands, cwd, env, logger } = params;

    // Handle empty/undefined commands
    if (!commands || commands.length === 0) {
      logger.info("No postGenerate hooks to run.");
      return {
        total: 0,
        succeeded: 0,
        failed: 0,
        success: true,
        totalDurationMs: 0,
        results: [],
      };
    }

    const results: HookResult[] = [];
    let totalDurationMs = 0;
    const total = commands.length;

    logger.info(`Running ${total} postGenerate hook${total === 1 ? "" : "s"}...`);

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const hookNumber = i + 1;

      logger.info(`Running postGenerate hook (${hookNumber}/${total}): ${command}`);

      const result = await this.executeCommand(command, cwd, env, logger);
      results.push(result);
      totalDurationMs += result.durationMs;

      if (result.success) {
        logger.info(
          `Hook (${hookNumber}/${total}) completed successfully in ${this.formatDuration(result.durationMs)}`
        );
      } else {
        logger.error(
          `Hook (${hookNumber}/${total}) failed with exit code ${result.exitCode} ` +
          `after ${this.formatDuration(result.durationMs)}`
        );

        // Abort on first failure
        throw new ScaffoldError(
          `postGenerate hook failed`,
          "HOOK_EXECUTION_FAILED",
          {
            command,
            cwd,
            exitCode: result.exitCode,
            hookNumber,
            totalHooks: total,
            error: result.error,
          },
          undefined,
          `Hook command failed: "${command}" (exit code ${result.exitCode}). ` +
            `${result.error ? `Error: ${result.error}. ` : ""}` +
            `Run the command manually in the target directory to debug: cd "${cwd}" && ${command}`,
          undefined,
          true
        );
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(
      `All ${total} hook${total === 1 ? "" : "s"} completed successfully ` +
      `in ${this.formatDuration(totalDurationMs)}`
    );

    return {
      total,
      succeeded,
      failed,
      success: failed === 0,
      totalDurationMs,
      results,
    };
  }

  /**
   * Executes a single command.
   *
   * @param command - Shell command string
   * @param cwd - Working directory
   * @param env - Additional environment variables
   * @param logger - Logger for output
   * @returns Hook execution result
   */
  private async executeCommand(
    command: string,
    cwd: string,
    env: Record<string, string> | undefined,
    logger: HookLogger
  ): Promise<HookResult> {
    const startTime = Date.now();

    const execaOptions: ExecaOptions = {
      cwd,
      shell: true,
      env: env ? { ...process.env, ...env } : process.env,
      // Stream output for visibility
      stdout: "pipe",
      stderr: "pipe",
      // Don't throw on non-zero exit - we handle it manually
      reject: false,
    };

    try {
      const subprocess = execa({ ...execaOptions })`${command}`;

      // Stream stdout
      if (subprocess.stdout) {
        subprocess.stdout.on("data", (chunk: Buffer) => {
          const lines = chunk.toString().split("\n").filter((l) => l.trim());
          for (const line of lines) {
            if (logger.stdout) {
              logger.stdout(line);
            } else {
              logger.info(`  ${line}`);
            }
          }
        });
      }

      // Stream stderr
      if (subprocess.stderr) {
        subprocess.stderr.on("data", (chunk: Buffer) => {
          const lines = chunk.toString().split("\n").filter((l) => l.trim());
          for (const line of lines) {
            if (logger.stderr) {
              logger.stderr(line);
            } else {
              logger.error(`  ${line}`);
            }
          }
        });
      }

      const result = await subprocess;
      const durationMs = Date.now() - startTime;

      // execa returns exitCode as a number
      const exitCode = result.exitCode ?? (result.failed ? 1 : 0);

      // Convert stderr to string (may be array or Uint8Array in execa v9)
      let stderrStr: string | undefined;
      if (result.stderr) {
        stderrStr = typeof result.stderr === "string"
          ? result.stderr
          : Array.isArray(result.stderr)
            ? result.stderr.join("\n")
            : result.stderr.toString();
      }

      return {
        command,
        success: exitCode === 0,
        exitCode,
        durationMs,
        error: result.failed ? stderrStr || result.message : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return {
        command,
        success: false,
        exitCode: 1,
        durationMs,
        error: message,
      };
    }
  }

  /**
   * Formats duration in human-readable format.
   *
   * @param ms - Duration in milliseconds
   * @returns Formatted string (e.g., "1.23s" or "456ms")
   */
  private formatDuration(ms: number): string {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms}ms`;
  }
}
