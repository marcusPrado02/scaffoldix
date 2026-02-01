/**
 * Execution context for structured logging.
 *
 * Provides correlation ID and step tracking for each CLI execution.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { Step } from "./Step.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Execution context for a single CLI run.
 *
 * Contains identifiers that are enriched into every log entry
 * for tracing and debugging.
 */
export interface ExecutionContext {
  /** Unique identifier for this execution (UUID or short token) */
  readonly correlationId: string;

  /** Current pipeline step (optional, set during execution) */
  readonly step?: Step;

  /** Additional context metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Options for creating an execution context.
 */
export interface CreateExecutionContextOptions {
  /** Custom correlation ID (default: auto-generated UUID) */
  correlationId?: string;

  /** Initial step */
  step?: Step;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new execution context.
 *
 * @param options - Optional configuration
 * @returns New execution context with unique correlationId
 *
 * @example
 * ```typescript
 * const ctx = createExecutionContext();
 * console.log(ctx.correlationId); // "a1b2c3d4-..."
 *
 * const ctxWithStep = createExecutionContext({ step: Step.MANIFEST_LOAD });
 * ```
 */
export function createExecutionContext(
  options: CreateExecutionContextOptions = {}
): ExecutionContext {
  return {
    correlationId: options.correlationId ?? generateCorrelationId(),
    step: options.step,
    metadata: options.metadata,
  };
}

/**
 * Creates a new context with updated fields.
 *
 * @param ctx - Base context
 * @param updates - Fields to update
 * @returns New context with updates applied
 */
export function updateExecutionContext(
  ctx: ExecutionContext,
  updates: Partial<ExecutionContext>
): ExecutionContext {
  return {
    ...ctx,
    ...updates,
    metadata: {
      ...ctx.metadata,
      ...updates.metadata,
    },
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Generates a unique correlation ID.
 *
 * Uses UUID v4 for uniqueness.
 */
function generateCorrelationId(): string {
  return randomUUID();
}
