/**
 * Check Runner - Executes shell commands as mandatory quality gates.
 *
 * This module provides a way to run quality checks (build, test, lint) as
 * part of the scaffolding lifecycle. Unlike postGenerate hooks, checks are
 * mandatory gates - if any check fails, generation is not considered successful.
 *
 * ## Features
 *
 * - Sequential execution in manifest order
 * - Fail-fast: stops on first failure
 * - Full output capture on failure (stdout + stderr)
 * - Actionable error messages with debugging instructions
 * - Duration tracking for each check
 *
 * ## Difference from HookRunner
 *
 * - CheckRunner captures FULL output for failure diagnosis
 * - Errors include complete command output for debugging
 * - Designed for build/test/lint commands that must pass
 *
 * @module
 */

import { execa, type Options as ExecaOptions } from "execa";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for check execution.
 */
export interface CheckLogger {
  /** Log informational messages */
  info(message: string): void;

  /** Log error messages */
  error(message: string): void;

  /** Log command output (stdout) - optional */
  stdout?(line: string): void;

  /** Log command output (stderr) - optional */
  stderr?(line: string): void;

  /** Log a complete output block (for failure diagnosis) - optional */
  outputBlock?(output: string): void;
}

/**
 * Parameters for running checks.
 */
export interface RunChecksParams {
  /** Array of shell command strings to execute */
  readonly commands: readonly string[];

  /** Working directory for command execution */
  readonly cwd: string;

  /** Logger for output */
  readonly logger: CheckLogger;

  /**
   * If true, run all checks concurrently instead of sequentially.
   * All checks run even if some fail; results are collected and reported together.
   * Useful when checks are independent (e.g. lint + type-check + test in parallel).
   * Default: false (sequential, fail-fast).
   */
  readonly parallel?: boolean;

  /**
   * Timeout in milliseconds for each individual check command.
   * The process is killed (SIGTERM) if it exceeds this duration.
   * Default: no timeout.
   */
  readonly timeoutMs?: number;

  /**
   * Number of times to retry a failed check before giving up.
   * Retries use exponential backoff (base 2s, capped at 30s).
   * Default: 0 (no retries).
   */
  readonly retries?: number;
}

/**
 * Result of a single check execution.
 */
export interface CheckResult {
  /** The command that was executed */
  readonly command: string;

  /** Whether the check passed */
  readonly success: boolean;

  /** Exit code (0 for success) */
  readonly exitCode: number;

  /** Duration in milliseconds */
  readonly durationMs: number;

  /** Captured output (stdout + stderr combined) */
  readonly capturedOutput: string;
}

/**
 * Summary of all check executions.
 */
export interface CheckRunSummary {
  /** Total number of checks */
  readonly total: number;

  /** Number of checks that passed */
  readonly passed: number;

  /** Number of checks that failed */
  readonly failed: number;

  /** Whether all checks passed */
  readonly success: boolean;

  /** Total duration in milliseconds */
  readonly totalDurationMs: number;

  /** Individual check results */
  readonly results: CheckResult[];
}

// =============================================================================
// CheckRunner Class
// =============================================================================

/**
 * Executes shell commands as mandatory quality gates.
 *
 * @example
 * ```typescript
 * const runner = new CheckRunner();
 *
 * const summary = await runner.runChecks({
 *   commands: ["npm run build", "npm test", "npm run lint"],
 *   cwd: "/path/to/project",
 *   logger: console,
 * });
 *
 * if (!summary.success) {
 *   console.error("Quality checks failed!");
 * }
 * ```
 */
export class CheckRunner {
  /**
   * Runs checks sequentially as mandatory quality gates.
   *
   * @param params - Commands, cwd, and logger
   * @returns Summary of check executions
   * @throws ScaffoldError if any check fails
   */
  async runChecks(params: RunChecksParams): Promise<CheckRunSummary> {
    const { commands, cwd, logger, parallel = false, timeoutMs, retries = 0 } = params;

    // Handle empty/undefined commands
    if (!commands || commands.length === 0) {
      logger.info("No checks configured.");
      return {
        total: 0,
        passed: 0,
        failed: 0,
        success: true,
        totalDurationMs: 0,
        results: [],
      };
    }

    const total = commands.length;

    if (parallel) {
      return this.runChecksParallel(commands, total, cwd, logger, timeoutMs, retries);
    }

    return this.runChecksSequential(commands, total, cwd, logger, timeoutMs, retries);
  }

  /**
   * Runs checks sequentially with fail-fast semantics.
   */
  private async runChecksSequential(
    commands: readonly string[],
    total: number,
    cwd: string,
    logger: CheckLogger,
    timeoutMs?: number,
    retries = 0,
  ): Promise<CheckRunSummary> {
    const results: CheckResult[] = [];
    let totalDurationMs = 0;

    logger.info(`Running ${total} check${total === 1 ? "" : "s"} (sequential)...`);

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      const checkNumber = i + 1;

      logger.info(`Running check (${checkNumber}/${total}): ${command}`);

      const result = await this.retryExecuteCheck(command, cwd, logger, timeoutMs, retries);
      results.push(result);
      totalDurationMs += result.durationMs;

      if (result.success) {
        logger.info(`Check passed in ${this.formatDuration(result.durationMs)}: ${command}`);
      } else {
        logger.error(`Check FAILED in ${this.formatDuration(result.durationMs)}: ${command}`);
        logger.error(`Exit code: ${result.exitCode}`);

        if (result.capturedOutput) {
          logger.error("--- Command Output ---");
          if (logger.outputBlock) {
            logger.outputBlock(result.capturedOutput);
          } else {
            logger.error(result.capturedOutput);
          }
          logger.error("--- End Output ---");
        }

        throw new ScaffoldError(
          `Quality check failed`,
          "CHECK_FAILED",
          {
            command,
            cwd,
            exitCode: result.exitCode,
            checkNumber,
            totalChecks: total,
            capturedOutput: result.capturedOutput,
          },
          undefined,
          `Check command failed: "${command}" (exit code ${result.exitCode}). ` +
            `Run the command manually in the target directory to debug: cd "${cwd}" && ${command}`,
          undefined,
          true,
        );
      }
    }

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(
      `All ${total} check${total === 1 ? "" : "s"} passed in ${this.formatDuration(totalDurationMs)}`,
    );

    return {
      total,
      passed,
      failed,
      success: failed === 0,
      totalDurationMs,
      results,
    };
  }

  /**
   * Runs all checks concurrently. All checks run even if some fail.
   * Throws after collecting all results if any check failed.
   */
  private async runChecksParallel(
    commands: readonly string[],
    total: number,
    cwd: string,
    logger: CheckLogger,
    timeoutMs?: number,
    retries = 0,
  ): Promise<CheckRunSummary> {
    logger.info(`Running ${total} check${total === 1 ? "" : "s"} (parallel)...`);

    // Launch all checks concurrently
    const promises = commands.map((command, i) => {
      logger.info(`Starting check (${i + 1}/${total}): ${command}`);
      return this.retryExecuteCheck(command, cwd, logger, timeoutMs, retries).then((result) => {
        if (result.success) {
          logger.info(`Check passed in ${this.formatDuration(result.durationMs)}: ${command}`);
        } else {
          logger.error(`Check FAILED in ${this.formatDuration(result.durationMs)}: ${command}`);
        }
        return result;
      });
    });

    const results = await Promise.all(promises);
    const totalDurationMs = Math.max(...results.map((r) => r.durationMs));

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed > 0) {
      const failedResults = results.filter((r) => !r.success);
      const failedSummary = failedResults
        .map((r) => `"${r.command}" (exit ${r.exitCode})`)
        .join(", ");

      for (const r of failedResults) {
        if (r.capturedOutput) {
          logger.error(`--- Output for: ${r.command} ---`);
          if (logger.outputBlock) {
            logger.outputBlock(r.capturedOutput);
          } else {
            logger.error(r.capturedOutput);
          }
        }
      }

      throw new ScaffoldError(
        `${failed} quality check${failed === 1 ? "" : "s"} failed`,
        "CHECK_FAILED",
        { failed, total, failedCommands: failedResults.map((r) => r.command), cwd },
        undefined,
        `${failed} of ${total} parallel check${failed === 1 ? "" : "s"} failed: ${failedSummary}. ` +
          `Run each command manually in "${cwd}" to debug.`,
        undefined,
        true,
      );
    }

    logger.info(
      `All ${total} parallel check${total === 1 ? "" : "s"} passed in ${this.formatDuration(totalDurationMs)}`,
    );

    return {
      total,
      passed,
      failed,
      success: true,
      totalDurationMs,
      results,
    };
  }

  /**
   * Executes a single check command.
   *
   * Uses `all: true` to capture combined stdout+stderr for failure diagnosis.
   *
   * @param command - Shell command string
   * @param cwd - Working directory
   * @param logger - Logger for streaming output
   * @returns Check execution result with captured output
   */
  /**
   * Executes a check with exponential backoff retries on failure.
   *
   * Retry delays: 2s, 4s, 8s, 16s, 30s (capped).
   */
  private async retryExecuteCheck(
    command: string,
    cwd: string,
    logger: CheckLogger,
    timeoutMs?: number,
    retries = 0,
  ): Promise<CheckResult> {
    let lastResult: CheckResult | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 30_000);
        logger.info(
          `Retry ${attempt}/${retries} for "${command}" in ${Math.round(delayMs / 1000)}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      lastResult = await this.executeCheck(command, cwd, logger, timeoutMs);

      if (lastResult.success) {
        if (attempt > 0) {
          logger.info(`Check succeeded on retry ${attempt}: ${command}`);
        }
        return lastResult;
      }
    }

    return lastResult!;
  }

  private async executeCheck(
    command: string,
    cwd: string,
    logger: CheckLogger,
    timeoutMs?: number,
  ): Promise<CheckResult> {
    const startTime = Date.now();

    const execaOptions: ExecaOptions = {
      cwd,
      shell: true,
      // Capture stdout, stderr, and combined 'all' output
      stdout: "pipe",
      stderr: "pipe",
      all: true,
      // Don't throw on non-zero exit - we handle it manually
      reject: false,
      // Optional timeout: kill process after given ms
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    };

    try {
      const subprocess = execa({ ...execaOptions })`${command}`;

      // Stream stdout for visibility
      if (subprocess.stdout) {
        subprocess.stdout.on("data", (chunk: Buffer) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((l) => l.trim());
          for (const line of lines) {
            if (logger.stdout) {
              logger.stdout(line);
            } else {
              logger.info(`  ${line}`);
            }
          }
        });
      }

      // Stream stderr for visibility
      if (subprocess.stderr) {
        subprocess.stderr.on("data", (chunk: Buffer) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((l) => l.trim());
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

      // Exit code handling
      const exitCode = result.exitCode ?? (result.failed ? 1 : 0);

      // Capture combined output (all = stdout + stderr interleaved)
      let capturedOutput = "";
      if (result.all !== undefined) {
        capturedOutput =
          typeof result.all === "string"
            ? result.all
            : Array.isArray(result.all)
              ? result.all.join("\n")
              : result.all.toString();
      } else {
        // Fallback: combine stdout and stderr
        const stdout = this.bufferToString(result.stdout);
        const stderr = this.bufferToString(result.stderr);
        capturedOutput = [stdout, stderr].filter(Boolean).join("\n");
      }

      return {
        command,
        success: exitCode === 0,
        exitCode,
        durationMs,
        capturedOutput,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout =
        error instanceof Error &&
        (error.message.includes("timed out") || (error as { timedOut?: boolean }).timedOut === true);
      const message = isTimeout
        ? `Check timed out after ${timeoutMs}ms: ${command}`
        : error instanceof Error
          ? error.message
          : String(error);

      return {
        command,
        success: false,
        exitCode: isTimeout ? 124 : 1, // 124 = standard timeout exit code
        durationMs,
        capturedOutput: message,
      };
    }
  }

  /**
   * Converts various buffer types to string.
   */
  private bufferToString(buffer: string | unknown[] | Uint8Array | undefined): string {
    if (!buffer) return "";
    if (typeof buffer === "string") return buffer;
    if (Array.isArray(buffer)) return buffer.join("\n");
    return buffer.toString();
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
