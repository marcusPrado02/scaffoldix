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

// =============================================================================
// Constants
// =============================================================================

/** Current schema version for state files. */
const CURRENT_SCHEMA_VERSION = 1;

/** Directory name for Scaffoldix metadata. */
const SCAFFOLDIX_DIR = ".scaffoldix";

/** State file name. */
const STATE_FILE = "state.json";

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Schema for a generation record.
 *
 * Captures all inputs used during a single generation run.
 */
export const GenerationRecordSchema = z.object({
  /** Pack identifier (may be scoped, e.g., @org/pack). */
  packId: z.string().min(1),

  /** Pack version string. */
  packVersion: z.string().min(1),

  /** Archetype identifier within the pack. */
  archetypeId: z.string().min(1),

  /** Inputs provided to templates. Stored exactly as used. */
  inputs: z.record(z.string(), z.unknown()),

  /** ISO 8601 timestamp of this generation. */
  timestamp: z.string(),
});

/**
 * Schema for the project state file.
 *
 * Uses explicit schema versioning for future compatibility.
 */
export const ProjectStateSchema = z.object({
  /** Schema version number. Must be a number, not a string. */
  schemaVersion: z.number().int().positive(),

  /** ISO 8601 timestamp of last update to this file. */
  updatedAt: z.string(),

  /** Most recent generation record. */
  lastGeneration: GenerationRecordSchema,
});

// =============================================================================
// Types
// =============================================================================

/**
 * A record of a single generation run.
 */
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

/**
 * The complete project state.
 */
export type ProjectState = z.infer<typeof ProjectStateSchema>;

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
 * // Write state after generation
 * await manager.write(targetDir, {
 *   packId: "my-pack",
 *   packVersion: "1.0.0",
 *   archetypeId: "default",
 *   inputs: { name: "MyEntity" },
 *   timestamp: new Date().toISOString(),
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
    // Normalize path to handle trailing slashes
    const normalized = path.resolve(targetDir);
    return path.join(normalized, SCAFFOLDIX_DIR, STATE_FILE);
  }

  /**
   * Reads the project state from disk.
   *
   * @param targetDir - The project's target directory
   * @returns The parsed state, or null if no state file exists
   * @throws ScaffoldError if the file exists but contains invalid JSON or schema
   */
  async read(targetDir: string): Promise<ProjectState | null> {
    const statePath = this.getStatePath(targetDir);

    // Check if file exists
    try {
      await fs.access(statePath);
    } catch {
      // File doesn't exist - this is normal
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
        true
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new ScaffoldError(
        `Invalid JSON in project state file`,
        "STATE_INVALID_JSON",
        { path: statePath },
        undefined,
        `The state file at ${statePath} contains invalid JSON. ` +
          `Delete the file or fix its contents manually.`,
        err instanceof Error ? err : undefined,
        true
      );
    }

    // Validate schema
    const result = ProjectStateSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");

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
        true
      );
    }

    return result.data;
  }

  /**
   * Writes a generation record to the project state.
   *
   * This method:
   * - Creates the `.scaffoldix/` directory if needed
   * - Updates `updatedAt` to current time
   * - Replaces `lastGeneration` with the new record
   * - Uses atomic writes to prevent corruption
   *
   * @param targetDir - The project's target directory
   * @param generation - The generation record to store
   * @returns The complete updated state
   */
  async write(targetDir: string, generation: GenerationRecord): Promise<ProjectState> {
    const statePath = this.getStatePath(targetDir);
    const stateDir = path.dirname(statePath);

    // Ensure directory exists
    await fs.mkdir(stateDir, { recursive: true });

    // Build state object
    const state: ProjectState = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      lastGeneration: generation,
    };

    // Serialize with stable 2-space indentation
    const content = JSON.stringify(state, null, 2) + "\n";

    // Atomic write: write to temp file, then rename
    const tempPath = this.getTempPath(stateDir);

    try {
      // Write to temp file
      await fs.writeFile(tempPath, content, "utf-8");

      // Atomic rename (on POSIX, this is atomic; on Windows, it replaces)
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

    return state;
  }

  /**
   * Generates a unique temp file path for atomic writes.
   */
  private getTempPath(dir: string): string {
    const random = crypto.randomBytes(8).toString("hex");
    return path.join(dir, `${STATE_FILE}.tmp-${process.pid}-${random}`);
  }
}
