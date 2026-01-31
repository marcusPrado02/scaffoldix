/**
 * State Migration System for Scaffoldix.
 *
 * Provides versioned migrations for `.scaffoldix/state.json` files.
 * Automatically upgrades older state formats to the current schema.
 *
 * ## Design Principles
 *
 * - Migrations are idempotent (safe to re-run)
 * - Each migration transforms state from one version to the next
 * - Migrations are applied sequentially in order
 * - Future versions are rejected with clear errors
 *
 * @module
 */

import * as crypto from "node:crypto";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Current state schema version.
 * Bump this when the state structure changes.
 */
export const CURRENT_STATE_VERSION = 2;

// =============================================================================
// Types
// =============================================================================

/**
 * A single state migration.
 */
export interface StateMigration {
  /** Source version this migration applies to */
  readonly fromVersion: number;

  /** Target version after migration */
  readonly toVersion: number;

  /** Human-readable description of what this migration does */
  readonly description: string;

  /** Migration function that transforms state */
  readonly migrate: (oldState: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Result of running migrations.
 */
export interface MigrationResult {
  /** The migrated state (or original if no migration needed) */
  readonly state: Record<string, unknown>;

  /** Whether any migrations were applied */
  readonly migrated: boolean;

  /** List of migrations that were applied (e.g., ["1→2", "2→3"]) */
  readonly migrationsApplied: string[];
}

// =============================================================================
// Migrations Registry
// =============================================================================

/**
 * All registered migrations, in order from oldest to newest.
 */
const migrations: StateMigration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: "Convert lastGeneration to generations array",
    migrate: (oldState) => {
      // lastGeneration is validated to exist before migration is called
      const lastGeneration = oldState.lastGeneration as Record<string, unknown>;

      // Convert lastGeneration to a GenerationReport
      const migratedReport = {
        id: `migrated-${crypto.randomUUID()}`,
        timestamp: lastGeneration.timestamp as string,
        packId: lastGeneration.packId as string,
        packVersion: lastGeneration.packVersion as string,
        archetypeId: lastGeneration.archetypeId as string,
        inputs: lastGeneration.inputs as Record<string, unknown>,
        status: "success" as const,
      };

      return {
        schemaVersion: 2,
        updatedAt: oldState.updatedAt ?? new Date().toISOString(),
        generations: [migratedReport],
        lastGeneration: {
          packId: lastGeneration.packId,
          packVersion: lastGeneration.packVersion,
          archetypeId: lastGeneration.archetypeId,
          inputs: lastGeneration.inputs,
          timestamp: lastGeneration.timestamp,
        },
      };
    },
  },
];

// =============================================================================
// Migration Runner
// =============================================================================

/**
 * Runs all necessary migrations on a state object.
 *
 * ## Process
 *
 * 1. Detect current version (default to 1 if missing)
 * 2. If version > CURRENT_STATE_VERSION, throw error (future version)
 * 3. If version < CURRENT_STATE_VERSION, apply migrations sequentially
 * 4. Return migrated state with migration metadata
 *
 * @param state - The state object to migrate
 * @returns Migration result with state and metadata
 * @throws ScaffoldError if state version is unsupported
 */
export function runMigrations(state: Record<string, unknown>): MigrationResult {
  // Validate schemaVersion type if present
  if (state.schemaVersion !== undefined && typeof state.schemaVersion !== "number") {
    throw new ScaffoldError(
      `Invalid schemaVersion type: expected number, got ${typeof state.schemaVersion}`,
      "STATE_INVALID_SCHEMA",
      { schemaVersion: state.schemaVersion },
      undefined,
      `The state file has a corrupted schemaVersion field. Delete the file to reset state.`,
      undefined,
      true
    );
  }

  // Determine current version (default to 1 if missing)
  const currentVersion = typeof state.schemaVersion === "number" ? state.schemaVersion : 1;

  // For v1 states, validate that lastGeneration exists (required for migration)
  if (currentVersion === 1 && state.lastGeneration === undefined) {
    throw new ScaffoldError(
      `Invalid v1 state: missing lastGeneration field`,
      "STATE_INVALID_SCHEMA",
      { schemaVersion: currentVersion },
      undefined,
      `The state file is missing required fields. Delete the file to reset state.`,
      undefined,
      true
    );
  }

  // Check for unsupported future version
  if (currentVersion > CURRENT_STATE_VERSION) {
    throw new ScaffoldError(
      `Unsupported state version "${currentVersion}"`,
      "STATE_VERSION_UNSUPPORTED",
      {
        stateVersion: currentVersion,
        maxSupportedVersion: CURRENT_STATE_VERSION,
      },
      undefined,
      `This state file was created by a newer version of Scaffoldix. ` +
        `Please update Scaffoldix to the latest version, or regenerate this project.`,
      undefined,
      true
    );
  }

  // Already at current version - no migration needed
  if (currentVersion === CURRENT_STATE_VERSION) {
    return {
      state,
      migrated: false,
      migrationsApplied: [],
    };
  }

  // Apply migrations sequentially
  let migratedState = { ...state };
  const appliedMigrations: string[] = [];

  for (const migration of migrations) {
    // Get current version of state being migrated
    const stateVersion =
      typeof migratedState.schemaVersion === "number" ? migratedState.schemaVersion : 1;

    // Check if this migration applies
    if (stateVersion === migration.fromVersion) {
      migratedState = migration.migrate(migratedState);
      appliedMigrations.push(`${migration.fromVersion}→${migration.toVersion}`);
    }
  }

  return {
    state: migratedState,
    migrated: appliedMigrations.length > 0,
    migrationsApplied: appliedMigrations,
  };
}

/**
 * Gets all registered migrations.
 * Useful for testing and debugging.
 */
export function getMigrations(): readonly StateMigration[] {
  return migrations;
}
