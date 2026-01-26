/**
 * Handler for the `pack list` CLI command.
 *
 * This module contains the orchestration logic for listing installed packs
 * from the Scaffoldix registry.
 *
 * The handler is separated from the CLI wiring to enable direct testing.
 *
 * @module
 */

import {
  RegistryService,
  type RegistryPackEntry,
  type PackOrigin,
} from "../../core/registry/RegistryService.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for the pack list handler.
 */
export interface PackListDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;
}

/**
 * A pack entry formatted for display.
 */
export interface PackListEntry {
  /** Pack identifier */
  readonly packId: string;

  /** Pack version */
  readonly version: string;

  /** Human-readable origin string */
  readonly origin: string;

  /** Installation timestamp */
  readonly installedAt: string;
}

/**
 * Result of the pack list operation.
 */
export interface PackListResult {
  /** List of installed packs (sorted by packId) */
  readonly packs: PackListEntry[];

  /** Whether the registry file exists */
  readonly registryExists: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Formats a pack origin for user-friendly display.
 *
 * @param origin - The pack origin object
 * @returns Human-readable origin string
 *
 * @example
 * formatOrigin({ type: "local", localPath: "/path/to/pack" })
 * // => "local:/path/to/pack"
 *
 * formatOrigin({ type: "git", gitUrl: "https://github.com/org/repo", ref: "main" })
 * // => "git:https://github.com/org/repo#main"
 */
export function formatOrigin(origin: PackOrigin): string {
  switch (origin.type) {
    case "local":
      return `local:${origin.localPath}`;

    case "git": {
      let result = `git:${origin.gitUrl}`;
      if (origin.ref) {
        result += `#${origin.ref}`;
      } else if (origin.commit) {
        result += `@${origin.commit.slice(0, 7)}`; // Short SHA
      }
      return result;
    }

    case "zip":
      return `zip:${origin.zipUrl}`;

    case "npm": {
      let result = `npm:${origin.packageName}`;
      if (origin.registry) {
        result += ` (${origin.registry})`;
      }
      return result;
    }

    default:
      // Future-proof: handle unknown types gracefully
      return `unknown:${JSON.stringify(origin)}`;
  }
}

/**
 * Converts a registry entry to a display entry.
 */
function toListEntry(entry: RegistryPackEntry): PackListEntry {
  return {
    packId: entry.id,
    version: entry.version,
    origin: formatOrigin(entry.origin),
    installedAt: entry.installedAt,
  };
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handles the `pack list` command.
 *
 * ## Process
 *
 * 1. Load the registry using RegistryService
 * 2. Convert entries to display format
 * 3. Sort by packId (ascending)
 * 4. Return the result
 *
 * ## Error Handling
 *
 * - Missing registry file: Returns empty list (not an error)
 * - Invalid JSON or schema: Throws ScaffoldError with actionable message
 *
 * @param deps - Injected dependencies (registry file path)
 * @returns Result with list of packs
 * @throws ScaffoldError on registry corruption
 */
export async function handlePackList(
  deps: PackListDependencies
): Promise<PackListResult> {
  const { registryFile } = deps;

  const registryService = new RegistryService(registryFile);

  // Load registry (returns empty if file doesn't exist)
  const registry = await registryService.load();

  // Convert to list and sort
  const entries = Object.values(registry.packs);
  const packs = entries
    .map(toListEntry)
    .sort((a, b) => a.packId.localeCompare(b.packId));

  // Determine if registry file actually exists (for messaging)
  // If we got packs, it exists. If empty, we can't tell from the data alone,
  // but for UX purposes, an empty result is an empty result.
  const registryExists = entries.length > 0;

  return {
    packs,
    registryExists,
  };
}

/**
 * Formats the pack list result for CLI output.
 *
 * @param result - The pack list result
 * @returns Array of output lines
 */
export function formatPackListOutput(result: PackListResult): string[] {
  if (result.packs.length === 0) {
    return ["No packs installed. Use `scaffoldix pack add <path>` to install one."];
  }

  // Calculate column widths for alignment
  const idWidth = Math.max(...result.packs.map((p) => p.packId.length), 8);
  const versionWidth = Math.max(...result.packs.map((p) => p.version.length), 7);

  const lines: string[] = [];

  // Header
  const header = `${"PACK".padEnd(idWidth)}  ${"VERSION".padEnd(versionWidth)}  ORIGIN`;
  lines.push(header);
  lines.push("-".repeat(header.length));

  // Pack entries
  for (const pack of result.packs) {
    const line = `${pack.packId.padEnd(idWidth)}  ${pack.version.padEnd(versionWidth)}  ${pack.origin}`;
    lines.push(line);
  }

  return lines;
}
