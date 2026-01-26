/**
 * Handler for the `archetypes list` CLI command.
 *
 * This module aggregates all archetypes across all installed packs,
 * providing a global view of available archetypes.
 *
 * The handler is resilient: a single invalid pack does not break the
 * entire command. Instead, warnings are emitted and the command continues.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RegistryService } from "../../core/registry/RegistryService.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for the archetypes list handler.
 */
export interface ArchetypesListDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;

  /** Absolute path to the packs directory */
  readonly packsDir: string;
}

/**
 * Result of the archetypes list operation.
 */
export interface ArchetypesListResult {
  /** List of archetypes in "packId:archetypeId" format, sorted */
  readonly archetypes: string[];

  /** True if no packs are installed */
  readonly noPacksInstalled: boolean;

  /** Warnings for packs that could not be processed (missing/invalid) */
  readonly warnings: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sanitizes a pack ID for use in filesystem paths.
 * Must match the logic in StoreService.
 */
function sanitizePackId(packId: string): string {
  return packId
    .replace(/\//g, "__") // Replace / with __ (scoped packages)
    .replace(/[<>:"|?*]/g, "_"); // Replace Windows-unsafe chars
}

/**
 * Derives the store path for a pack based on its ID and hash.
 * Must match StoreService.getPackDestDir() logic.
 */
function deriveStorePath(packsDir: string, packId: string, hash: string): string {
  const sanitizedId = sanitizePackId(packId);
  return path.join(packsDir, sanitizedId, hash);
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handles the `archetypes list` command.
 *
 * ## Process
 *
 * 1. Load the registry
 * 2. For each pack (in deterministic order by packId):
 *    a. Validate storePath exists
 *    b. Load manifest via ManifestLoader
 *    c. Extract archetype IDs
 * 3. Aggregate and sort all archetypes
 * 4. Return result with any warnings
 *
 * ## Error Handling
 *
 * - Corrupted registry: Throws (fatal, actionable error)
 * - Missing/invalid pack: Emits warning and continues
 *
 * @param deps - Injected dependencies
 * @returns Aggregated list of archetypes with warnings
 * @throws ScaffoldError on registry corruption
 */
export async function handleArchetypesList(
  deps: ArchetypesListDependencies
): Promise<ArchetypesListResult> {
  const { registryFile, packsDir } = deps;

  // 1. Load registry (throws on corruption)
  const registryService = new RegistryService(registryFile);
  const registry = await registryService.load();

  const packEntries = Object.values(registry.packs);

  // Check if registry is empty
  if (packEntries.length === 0) {
    return {
      archetypes: [],
      noPacksInstalled: true,
      warnings: [],
    };
  }

  // Sort pack entries by packId for deterministic processing order
  const sortedPacks = packEntries.slice().sort((a, b) => a.id.localeCompare(b.id));

  const allArchetypes: string[] = [];
  const warnings: string[] = [];

  // 2. Process each pack
  for (const pack of sortedPacks) {
    const storePath = deriveStorePath(packsDir, pack.id, pack.hash);

    // 2a. Validate storePath exists
    try {
      await fs.access(storePath);
    } catch {
      warnings.push(
        `Warning: pack '${pack.id}' is registered but missing from store: ${storePath}`
      );
      continue;
    }

    // 2b. Load manifest
    const manifestLoader = new ManifestLoader();
    try {
      const manifest = await manifestLoader.loadFromDir(storePath);

      // 2c. Extract archetype IDs (use exact ID from manifest)
      for (const archetype of manifest.archetypes) {
        allArchetypes.push(`${pack.id}:${archetype.id}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      warnings.push(
        `Warning: pack '${pack.id}' has invalid manifest at ${storePath}: ${errorMessage}`
      );
      continue;
    }
  }

  // 3. Sort all archetypes (packId:archetypeId lexicographically)
  allArchetypes.sort((a, b) => a.localeCompare(b));

  return {
    archetypes: allArchetypes,
    noPacksInstalled: false,
    warnings,
  };
}

/**
 * Formats the archetypes list result for CLI output.
 *
 * Separates stdout (archetype list) from stderr (warnings) to allow
 * piping the clean list for scripting while still showing warnings.
 *
 * @param result - The archetypes list result
 * @returns Object with stdout lines and stderr lines
 */
export function formatArchetypesListOutput(result: ArchetypesListResult): {
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  // Warnings go to stderr
  for (const warning of result.warnings) {
    stderr.push(warning);
  }

  // Handle empty cases
  if (result.noPacksInstalled) {
    stdout.push("No packs installed. Use `scaffoldix pack add <path>` first.");
    return { stdout, stderr };
  }

  if (result.archetypes.length === 0) {
    // Packs exist but none have valid archetypes (all invalid)
    stdout.push("No archetypes available. Check warnings above for details.");
    return { stdout, stderr };
  }

  // Output archetypes one per line (no decoration for scripting)
  for (const archetype of result.archetypes) {
    stdout.push(archetype);
  }

  return { stdout, stderr };
}
