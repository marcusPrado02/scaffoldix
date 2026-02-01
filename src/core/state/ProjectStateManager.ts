/**
 * Project State Manager.
 *
 * Manages project-local state stored at `<targetDir>/.scaffoldix/state.json`.
 * This tracks generation history to support future features like upgrades
 * and migration detection.
 *
 * ## State Location
 *
 * State is stored per-project, NOT in the global store:
 * - `<targetDir>/.scaffoldix/state.json`
 *
 * ## Schema Versioning
 *
 * - v1: Original schema with `lastGeneration` only
 * - v2: Extended schema with `generations` array for history
 *
 * The manager reads both v1 and v2, and always writes v2.
 *
 * ## Atomic Writes
 *
 * All writes are atomic to prevent corruption:
 * 1. Write to temp file in same directory
 * 2. Rename temp to final (atomic on POSIX)
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { z } from "zod";
import { ScaffoldError } from "../errors/errors.js";
import { runMigrations, CURRENT_STATE_VERSION } from "./migrations.js";

// =============================================================================
// Constants
// =============================================================================

/** Current schema version for state files. */
export const CURRENT_SCHEMA_VERSION = 2;

/** Directory name for Scaffoldix metadata. */
const SCAFFOLDIX_DIR = ".scaffoldix";

/** State file name. */
const STATE_FILE = "state.json";

/** Maximum number of generations to keep in history. */
const MAX_GENERATIONS = 50;

// =============================================================================
// Zod Schemas - v1 (legacy)
// =============================================================================

/**
 * Schema for a v1 generation record.
 * Used for backward compatibility when reading old state files.
 */
export const GenerationRecordV1Schema = z.object({
  packId: z.string().min(1),
  packVersion: z.string().min(1),
  archetypeId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});

/**
 * Schema for v1 project state.
 */
export const ProjectStateV1Schema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  lastGeneration: GenerationRecordV1Schema,
});

// =============================================================================
// Zod Schemas - v2 (current)
// =============================================================================

/**
 * Schema for a patch item in a generation report.
 */
export const PatchItemSchema = z.object({
  kind: z.string(),
  file: z.string(),
  idempotencyKey: z.string(),
  status: z.enum(["applied", "skipped", "failed"]),
  reason: z.string().optional(),
  durationMs: z.number().optional(),
});

/**
 * Schema for patches summary in a generation report.
 */
export const PatchesSummarySchema = z.object({
  total: z.number(),
  applied: z.number(),
  skipped: z.number(),
  failed: z.number(),
  items: z.array(PatchItemSchema),
});

/**
 * Schema for a hook/check item in a generation report.
 */
export const CommandItemSchema = z.object({
  command: z.string(),
  status: z.enum(["success", "failure"]),
  exitCode: z.number(),
  durationMs: z.number().optional(),
});

/**
 * Schema for hooks summary in a generation report.
 */
export const HooksSummarySchema = z.object({
  items: z.array(CommandItemSchema),
});

/**
 * Schema for checks summary in a generation report.
 */
export const ChecksSummarySchema = z.object({
  items: z.array(CommandItemSchema),
});

/**
 * Schema for error details in a generation report.
 */
export const GenerationErrorSchema = z.object({
  stage: z.enum(["render", "patches", "postGenerate", "checks", "commit"]),
  message: z.string(),
  details: z.string().optional(),
});

/**
 * Schema for staging info in a generation report.
 */
export const StagingInfoSchema = z.object({
  used: z.boolean(),
  committedTo: z.string().optional(),
});

/**
 * Schema for a full generation report (v2).
 */
export const GenerationReportSchema = z.object({
  /** Unique ID for this generation run. */
  id: z.string(),

  /** ISO 8601 timestamp of this generation. */
  timestamp: z.string(),

  /** Pack identifier (may be scoped, e.g., @org/pack). */
  packId: z.string().min(1),

  /** Pack version string. */
  packVersion: z.string().min(1),

  /** Archetype identifier within the pack. */
  archetypeId: z.string().min(1),

  /** Inputs provided to templates. Stored exactly as used. */
  inputs: z.record(z.string(), z.unknown()),

  /** Final status of the generation. */
  status: z.enum(["success", "failure"]),

  /** Staging info (optional). */
  staging: StagingInfoSchema.optional(),

  /** Patches summary (optional, present if patches were run). */
  patches: PatchesSummarySchema.optional(),

  /** Hooks summary (optional, present if hooks were run). */
  hooks: HooksSummarySchema.optional(),

  /** Checks summary (optional, present if checks were run). */
  checks: ChecksSummarySchema.optional(),

  /** Error details (present on failure). */
  error: GenerationErrorSchema.optional(),
});

/**
 * Schema for v2 project state with generation history.
 */
export const ProjectStateV2Schema = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.string(),
  generations: z.array(GenerationReportSchema),
  /** Computed field for backward compatibility. */
  lastGeneration: GenerationRecordV1Schema,
});

/**
 * Combined schema that accepts either v1 or v2.
 */
export const ProjectStateAnySchema = z.union([ProjectStateV1Schema, ProjectStateV2Schema]);

// =============================================================================
// Types
// =============================================================================

/**
 * A v1 generation record (legacy).
 */
export type GenerationRecord = z.infer<typeof GenerationRecordV1Schema>;

/**
 * A patch item in a generation report.
 */
export type PatchItem = z.infer<typeof PatchItemSchema>;

/**
 * Patches summary in a generation report.
 */
export type PatchesSummary = z.infer<typeof PatchesSummarySchema>;

/**
 * A command item (hook or check) in a generation report.
 */
export type CommandItem = z.infer<typeof CommandItemSchema>;

/**
 * Hooks summary in a generation report.
 */
export type HooksSummary = z.infer<typeof HooksSummarySchema>;

/**
 * Checks summary in a generation report.
 */
export type ChecksSummary = z.infer<typeof ChecksSummarySchema>;

/**
 * Error details in a generation report.
 */
export type GenerationError = z.infer<typeof GenerationErrorSchema>;

/**
 * Staging info in a generation report.
 */
export type StagingInfo = z.infer<typeof StagingInfoSchema>;

/**
 * A full generation report.
 */
export type GenerationReport = z.infer<typeof GenerationReportSchema>;

/**
 * v1 project state (legacy).
 */
export type ProjectStateV1 = z.infer<typeof ProjectStateV1Schema>;

/**
 * v2 project state with generation history.
 */
export type ProjectStateV2 = z.infer<typeof ProjectStateV2Schema>;

/**
 * Project state (either v1 or v2).
 */
export type ProjectState = ProjectStateV1 | ProjectStateV2;

// =============================================================================
// ProjectStateManager
// =============================================================================

/**
 * Manages project-local state for Scaffoldix.
 *
 * ## Usage
 *
 * ```typescript
 * const manager = new ProjectStateManager();
 *
 * // Record a generation with full report
 * await manager.recordGeneration(targetDir, {
 *   id: "gen-123",
 *   timestamp: new Date().toISOString(),
 *   packId: "my-pack",
 *   packVersion: "1.0.0",
 *   archetypeId: "default",
 *   inputs: { name: "MyEntity" },
 *   status: "success",
 *   patches: { total: 2, applied: 2, skipped: 0, failed: 0, items: [...] },
 * });
 *
 * // Read existing state
 * const state = await manager.read(targetDir);
 * if (state) {
 *   console.log("Last generation:", state.lastGeneration.packId);
 * }
 * ```
 */
export class ProjectStateManager {
  /**
   * Gets the path to the state file for a target directory.
   *
   * @param targetDir - The project's target directory
   * @returns Absolute path to the state file
   */
  getStatePath(targetDir: string): string {
    const normalized = path.resolve(targetDir);
    return path.join(normalized, SCAFFOLDIX_DIR, STATE_FILE);
  }

  /**
   * Reads the project state from disk.
   *
   * Handles both v1 and v2 schemas transparently.
   * Automatically migrates older state files to the current version.
   *
   * @param targetDir - The project's target directory
   * @returns The parsed state, or null if no state file exists
   * @throws ScaffoldError if the file exists but contains invalid JSON or schema
   * @throws ScaffoldError if the state version is unsupported (future version)
   */
  async read(targetDir: string): Promise<ProjectState | null> {
    const statePath = this.getStatePath(targetDir);

    // Check if file exists
    try {
      await fs.access(statePath);
    } catch {
      return null;
    }

    // Read file content
    let content: string;
    try {
      content = await fs.readFile(statePath, "utf-8");
    } catch (err) {
      throw new ScaffoldError(
        `Failed to read project state file`,
        "STATE_READ_ERROR",
        { path: statePath },
        undefined,
        `Could not read the state file at ${statePath}. Check file permissions.`,
        err instanceof Error ? err : undefined,
        true,
      );
    }

    // Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
      throw new ScaffoldError(
        `Invalid JSON in project state file`,
        "STATE_INVALID_JSON",
        { path: statePath },
        undefined,
        `The state file at ${statePath} contains invalid JSON. ` +
          `Delete the file or fix its contents manually.`,
        err instanceof Error ? err : undefined,
        true,
      );
    }

    // Check for unsupported future version BEFORE schema validation
    const stateVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
    if (stateVersion > CURRENT_STATE_VERSION) {
      throw new ScaffoldError(
        `Unsupported state version "${stateVersion}"`,
        "STATE_VERSION_UNSUPPORTED",
        {
          path: statePath,
          stateVersion,
          maxSupportedVersion: CURRENT_STATE_VERSION,
        },
        undefined,
        `This state file was created by a newer version of Scaffoldix. ` +
          `Please update Scaffoldix to the latest version, or regenerate this project.`,
        undefined,
        true,
      );
    }

    // Run migrations if needed (wrap errors to include file path)
    let migrationResult;
    try {
      migrationResult = runMigrations(parsed);
    } catch (err) {
      // Re-throw migration errors with file path context
      if (err instanceof ScaffoldError && err.code === "STATE_INVALID_SCHEMA") {
        throw new ScaffoldError(
          err.message,
          "STATE_INVALID_SCHEMA",
          { path: statePath, ...err.details },
          undefined,
          `The state file at ${statePath} has an invalid structure. ` +
            `Delete the file to reset state, or fix it manually.`,
          err,
          true,
        );
      }
      throw err;
    }

    // If migrations were applied, write the migrated state back to disk
    if (migrationResult.migrated) {
      const stateDir = path.dirname(statePath);
      const migratedContent = JSON.stringify(migrationResult.state, null, 2) + "\n";
      await this.atomicWrite(stateDir, statePath, migratedContent);
    }

    // Validate schema (accepts both v1 and v2, but after migration should be v2)
    const result = ProjectStateAnySchema.safeParse(migrationResult.state);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

      throw new ScaffoldError(
        `Invalid project state schema`,
        "STATE_INVALID_SCHEMA",
        {
          path: statePath,
          issues: result.error.issues,
        },
        undefined,
        `The state file at ${statePath} has an invalid structure: ${issues}. ` +
          `Delete the file to reset state, or fix it manually.`,
        undefined,
        true,
      );
    }

    return result.data;
  }

  /**
   * Writes a v1 generation record to the project state (legacy method).
   *
   * @deprecated Use recordGeneration() for full report persistence.
   */
  async write(targetDir: string, generation: GenerationRecord): Promise<ProjectState> {
    // Convert to a GenerationReport and use recordGeneration
    const report: GenerationReport = {
      id: crypto.randomUUID(),
      timestamp: generation.timestamp,
      packId: generation.packId,
      packVersion: generation.packVersion,
      archetypeId: generation.archetypeId,
      inputs: generation.inputs,
      status: "success",
    };

    return this.recordGeneration(targetDir, report);
  }

  /**
   * Records a full generation report to the project state.
   *
   * This method:
   * - Creates the `.scaffoldix/` directory if needed
   * - Appends the report to the generations history
   * - Migrates v1 state to v2 if needed
   * - Bounds history to MAX_GENERATIONS entries
   * - Updates `updatedAt` to current time
   * - Uses atomic writes to prevent corruption
   *
   * @param targetDir - The project's target directory
   * @param report - The generation report to store
   * @returns The complete updated state
   */
  async recordGeneration(targetDir: string, report: GenerationReport): Promise<ProjectStateV2> {
    const statePath = this.getStatePath(targetDir);
    const stateDir = path.dirname(statePath);

    // Ensure directory exists
    await fs.mkdir(stateDir, { recursive: true });

    // Read existing state (if any)
    const existingState = await this.read(targetDir);

    // Build generations array
    let generations: GenerationReport[];

    if (existingState === null) {
      // No existing state - start fresh
      generations = [report];
    } else if (existingState.schemaVersion === 1) {
      // Migrate v1 to v2: convert lastGeneration to a report
      const migratedReport = this.migrateV1Record(existingState.lastGeneration);
      generations = [migratedReport, report];
    } else {
      // v2 state - append to existing generations
      generations = [...existingState.generations, report];
    }

    // Bound history to MAX_GENERATIONS
    if (generations.length > MAX_GENERATIONS) {
      generations = generations.slice(generations.length - MAX_GENERATIONS);
    }

    // Compute lastGeneration for backward compatibility
    const lastReport = generations[generations.length - 1];
    const lastGeneration: GenerationRecord = {
      packId: lastReport.packId,
      packVersion: lastReport.packVersion,
      archetypeId: lastReport.archetypeId,
      inputs: lastReport.inputs,
      timestamp: lastReport.timestamp,
    };

    // Build v2 state object
    const state: ProjectStateV2 = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      generations,
      lastGeneration,
    };

    // Serialize with stable 2-space indentation
    const content = JSON.stringify(state, null, 2) + "\n";

    // Atomic write
    await this.atomicWrite(stateDir, statePath, content);

    return state;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Migrates a v1 GenerationRecord to a v2 GenerationReport.
   */
  private migrateV1Record(record: GenerationRecord): GenerationReport {
    return {
      id: `migrated-${crypto.randomUUID()}`,
      timestamp: record.timestamp,
      packId: record.packId,
      packVersion: record.packVersion,
      archetypeId: record.archetypeId,
      inputs: record.inputs,
      status: "success", // Assume success for migrated records
    };
  }

  /**
   * Performs an atomic write using temp file + rename.
   */
  private async atomicWrite(stateDir: string, statePath: string, content: string): Promise<void> {
    const tempPath = this.getTempPath(stateDir);

    try {
      await fs.writeFile(tempPath, content, "utf-8");
      await fs.rename(tempPath, statePath);
    } catch (err) {
      // Clean up temp file on failure (best effort)
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /**
   * Generates a unique temp file path for atomic writes.
   */
  private getTempPath(dir: string): string {
    const random = crypto.randomBytes(8).toString("hex");
    return path.join(dir, `${STATE_FILE}.tmp-${process.pid}-${random}`);
  }
}
