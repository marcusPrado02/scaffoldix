/**
 * Step Timer for pipeline instrumentation.
 *
 * Tracks step start/end times and emits structured log events
 * for timeline reconstruction and performance analysis.
 *
 * @module
 */

import type { ContextualLogger } from "./ContextualLogger.js";
import type { Step } from "./Step.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Step timing record.
 */
interface StepTiming {
  step: Step;
  startTime: number;
  context?: Record<string, unknown>;
}

// =============================================================================
// StepTimer Class
// =============================================================================

/**
 * Timer for tracking pipeline step durations.
 *
 * Emits `step.start` and `step.end` log events with timing information.
 *
 * @example
 * ```typescript
 * const timer = new StepTimer(logger);
 *
 * timer.start(Step.MANIFEST_LOAD);
 * await loadManifest();
 * timer.end(Step.MANIFEST_LOAD);
 *
 * // Or use the run helper:
 * const result = await timer.run(Step.RENDER, async () => {
 *   return await renderTemplates();
 * });
 * ```
 */
export class StepTimer {
  private readonly logger: ContextualLogger;
  private readonly timings: Map<Step, StepTiming> = new Map();

  constructor(logger: ContextualLogger) {
    this.logger = logger;
  }

  /**
   * Starts timing a step.
   *
   * @param step - Step to start
   * @param context - Optional context to include in start event
   */
  start(step: Step, context?: Record<string, unknown>): void {
    const timing: StepTiming = {
      step,
      startTime: Date.now(),
      context,
    };
    this.timings.set(step, timing);

    this.logger
      .withContext({ step })
      .info("Step started", { event: "step.start", ...context });
  }

  /**
   * Ends timing a step.
   *
   * @param step - Step to end
   * @param context - Optional context to include in end event
   */
  end(step: Step, context?: Record<string, unknown>): void {
    const timing = this.timings.get(step);
    if (!timing) {
      // Step not started, ignore
      return;
    }

    const durationMs = Date.now() - timing.startTime;
    this.timings.delete(step);

    this.logger
      .withContext({ step })
      .info("Step completed", { event: "step.end", durationMs, ...context });
  }

  /**
   * Ends timing a step with error.
   *
   * @param step - Step that failed
   * @param error - Error that occurred
   * @param context - Optional context
   */
  endWithError(
    step: Step,
    error: Error,
    context?: Record<string, unknown>
  ): void {
    const timing = this.timings.get(step);
    if (!timing) {
      return;
    }

    const durationMs = Date.now() - timing.startTime;
    this.timings.delete(step);

    this.logger.withContext({ step }).error("Step failed", {
      event: "step.end",
      durationMs,
      error,
      ...context,
    });
  }

  /**
   * Runs a function with automatic step timing.
   *
   * Starts the step before execution and ends it after,
   * handling both success and error cases.
   *
   * @param step - Step being executed
   * @param fn - Function to execute
   * @param context - Optional context for start event
   * @returns Result of the function
   */
  async run<T>(
    step: Step,
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    this.start(step, context);

    try {
      const result = await fn();
      this.end(step);
      return result;
    } catch (error) {
      const timing = this.timings.get(step);
      if (timing) {
        const durationMs = Date.now() - timing.startTime;
        this.timings.delete(step);

        this.logger.withContext({ step }).error("Step failed", {
          event: "step.end",
          durationMs,
          error: true,
        });
      }
      throw error;
    }
  }

  /**
   * Runs a synchronous function with automatic step timing.
   *
   * @param step - Step being executed
   * @param fn - Function to execute
   * @param context - Optional context for start event
   * @returns Result of the function
   */
  runSync<T>(
    step: Step,
    fn: () => T,
    context?: Record<string, unknown>
  ): T {
    this.start(step, context);

    try {
      const result = fn();
      this.end(step);
      return result;
    } catch (error) {
      const timing = this.timings.get(step);
      if (timing) {
        const durationMs = Date.now() - timing.startTime;
        this.timings.delete(step);

        this.logger.withContext({ step }).error("Step failed", {
          event: "step.end",
          durationMs,
          error: true,
        });
      }
      throw error;
    }
  }

  /**
   * Gets the duration of a currently running step.
   *
   * @param step - Step to check
   * @returns Duration in ms, or undefined if not running
   */
  getElapsed(step: Step): number | undefined {
    const timing = this.timings.get(step);
    if (!timing) {
      return undefined;
    }
    return Date.now() - timing.startTime;
  }

  /**
   * Checks if a step is currently running.
   *
   * @param step - Step to check
   * @returns True if step is in progress
   */
  isRunning(step: Step): boolean {
    return this.timings.has(step);
  }
}
