/**
 * Engine Trace Module.
 *
 * Provides observability for the Scaffoldix Engine by collecting
 * trace entries for each major execution phase.
 *
 * ## Usage
 *
 * ```typescript
 * const trace = new EngineTrace();
 *
 * trace.start("load manifest", { packId: "my-pack" });
 * await loadManifest();
 * trace.end("load manifest");
 *
 * trace.start("render templates");
 * await renderTemplates();
 * trace.end("render templates");
 *
 * console.log(trace.toHumanString());
 * // Or for JSON: trace.toJSON()
 * ```
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A single trace entry representing a phase's execution.
 */
export interface TraceEntry {
  /** Phase name (e.g., "load manifest", "render templates") */
  readonly name: string;

  /** Start timestamp */
  readonly start: Date;

  /** End timestamp (undefined if still running) */
  readonly end?: Date;

  /** Duration in milliseconds (undefined if still running) */
  readonly durationMs?: number;

  /** Optional context data */
  readonly context?: Record<string, unknown>;
}

/**
 * JSON representation of a trace entry.
 */
export interface TraceEntryJson {
  name: string;
  start: string;
  end?: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

/**
 * JSON output format for the trace.
 */
export interface TraceJson {
  trace: TraceEntryJson[];
  totalDurationMs: number;
}

// =============================================================================
// EngineTrace Class
// =============================================================================

/**
 * Collects and formats trace entries for engine execution phases.
 *
 * ## Features
 *
 * - Records start/end timestamps for each phase
 * - Calculates duration automatically
 * - Supports optional context metadata
 * - Outputs in human-readable or JSON format
 * - Handles incomplete phases gracefully
 */
export class EngineTrace {
  private entries: Map<string, MutableTraceEntry> = new Map();
  private order: string[] = [];

  /**
   * Starts tracing a phase.
   *
   * @param name - Phase name (should be unique per trace)
   * @param context - Optional context metadata
   */
  start(name: string, context?: Record<string, unknown>): void {
    const entry: MutableTraceEntry = {
      name,
      start: new Date(),
      context,
    };
    this.entries.set(name, entry);
    this.order.push(name);
  }

  /**
   * Ends tracing a phase and calculates duration.
   *
   * @param name - Phase name (must match a previous start call)
   */
  end(name: string): void {
    const entry = this.entries.get(name);
    if (!entry || entry.end) {
      // Phase not started or already ended - ignore
      return;
    }

    entry.end = new Date();
    entry.durationMs = entry.end.getTime() - entry.start.getTime();
  }

  /**
   * Returns all trace entries in order.
   */
  toArray(): TraceEntry[] {
    return this.order
      .map((name) => this.entries.get(name))
      .filter((e): e is MutableTraceEntry => e !== undefined)
      .map((e) => ({ ...e }));
  }

  /**
   * Returns the total duration of all completed phases.
   */
  totalDurationMs(): number {
    return this.toArray()
      .filter((e) => e.durationMs !== undefined)
      .reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  }

  /**
   * Returns JSON representation of the trace.
   */
  toJSON(): TraceJson {
    const trace: TraceEntryJson[] = this.toArray().map((entry) => ({
      name: entry.name,
      start: entry.start.toISOString(),
      end: entry.end?.toISOString(),
      durationMs: entry.durationMs,
      context: entry.context,
    }));

    return {
      trace,
      totalDurationMs: this.totalDurationMs(),
    };
  }

  /**
   * Returns human-readable summary of the trace.
   * Shows phase names and durations.
   */
  toHumanString(): string {
    const entries = this.toArray();
    if (entries.length === 0) {
      return "";
    }

    const lines: string[] = [];
    const maxNameLen = Math.max(...entries.map((e) => e.name.length));

    for (const entry of entries) {
      const name = entry.name.padEnd(maxNameLen);
      if (entry.durationMs !== undefined) {
        lines.push(`  ${name}  ${formatDuration(entry.durationMs)}`);
      } else {
        lines.push(`  ${name}  (in progress)`);
      }
    }

    const total = this.totalDurationMs();
    lines.push(`  ${"─".repeat(maxNameLen + 12)}`);
    lines.push(`  Completed in ${formatDuration(total)}`);

    return lines.join("\n");
  }

  /**
   * Returns detailed trace output with timestamps.
   * Suitable for verbose mode.
   */
  toDetailedString(): string {
    const entries = this.toArray();
    if (entries.length === 0) {
      return "";
    }

    const lines: string[] = [];
    const maxNameLen = Math.max(...entries.map((e) => e.name.length));

    for (const entry of entries) {
      const name = entry.name.padEnd(maxNameLen);
      const startTime = formatTime(entry.start);
      const endTime = entry.end ? formatTime(entry.end) : "...";
      const duration = entry.durationMs !== undefined ? formatDuration(entry.durationMs) : "(running)";

      lines.push(`  ${name}  start: ${startTime}  end: ${endTime}  duration: ${duration}`);

      // Include context if present
      if (entry.context && Object.keys(entry.context).length > 0) {
        const contextStr = Object.entries(entry.context)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        lines.push(`    context: ${contextStr}`);
      }
    }

    const total = this.totalDurationMs();
    lines.push(`  ${"─".repeat(60)}`);
    lines.push(`  Total: ${formatDuration(total)}`);

    return lines.join("\n");
  }
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Mutable version of TraceEntry for internal use.
 */
interface MutableTraceEntry {
  name: string;
  start: Date;
  end?: Date;
  durationMs?: number;
  context?: Record<string, unknown>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Formats a duration in milliseconds for display.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats a timestamp for display (HH:MM:SS.mmm).
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const millis = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
}
