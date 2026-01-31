/**
 * Handler for the `pack info <packId>` CLI command.
 *
 * This module contains the orchestration logic for displaying detailed
 * information about an installed pack.
 *
 * The handler is separated from the CLI wiring to enable direct testing.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScaffoldError } from "../../core/errors/errors.js";
import { type PackOrigin } from "../../core/registry/RegistryService.js";
import { PackResolver } from "../../core/store/PackResolver.js";
import { ManifestLoader, type PackManifest } from "../../core/manifest/ManifestLoader.js";
import { formatOrigin } from "./packListHandler.js";
import { CompatibilityChecker } from "../../core/compatibility/CompatibilityChecker.js";
import { CLI_VERSION } from "../version.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the pack info handler.
 */
export interface PackInfoInput {
  /** Pack identifier to look up */
  readonly packId: string;

  /** Optional version to select (for multi-version packs) */
  readonly version?: string;
}

/**
 * Dependencies for the pack info handler.
 */
export interface PackInfoDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;

  /** Absolute path to the packs directory */
  readonly packsDir: string;
}

/**
 * Result of the pack info operation.
 */
export interface PackInfoResult {
  /** Pack identifier */
  readonly packId: string;

  /** Pack version */
  readonly version: string;

  /** Pack origin (formatted for display) */
  readonly origin: string;

  /** Raw origin object (for programmatic use) */
  readonly originRaw: PackOrigin;

  /** Absolute path to the installed pack in the Store */
  readonly storePath: string;

  /** Installation timestamp (ISO 8601) */
  readonly installedAt: string;

  /** SHA-256 hash of the manifest */
  readonly hash: string;

  /** List of archetype IDs (sorted) */
  readonly archetypes: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validates pack compatibility with current CLI version.
 * Throws ScaffoldError if pack is incompatible.
 */
function validateCompatibility(manifest: PackManifest): void {
  const compatibility = manifest.scaffoldix?.compatibility;
  const result = CompatibilityChecker.check(CLI_VERSION, compatibility);

  if (!result.compatible) {
    const constraints = CompatibilityChecker.formatConstraints(compatibility);
    throw new ScaffoldError(
      `Pack incompatible with current Scaffoldix version`,
      "PACK_INCOMPATIBLE",
      {
        packId: manifest.pack.name,
        packVersion: manifest.pack.version,
        cliVersion: CLI_VERSION,
        constraints,
      },
      undefined,
      `Pack "${manifest.pack.name}@${manifest.pack.version}" requires Scaffoldix ${constraints}. ` +
        `You are using Scaffoldix v${CLI_VERSION}. ` +
        `Please upgrade Scaffoldix or use a compatible pack version.`,
      undefined,
      true
    );
  }
}

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
 * Handles the `pack info <packId>` command.
 *
 * ## Process
 *
 * 1. Load the registry
 * 2. Find the pack entry by packId
 * 3. Derive and validate the store path
 * 4. Load the manifest to get archetypes
 * 5. Return the formatted result
 *
 * ## Error Handling
 *
 * - Pack not found: Actionable error with guidance
 * - Store path missing: Error suggesting reinstall
 * - Manifest errors: Error with path and guidance
 *
 * @param input - User input (packId)
 * @param deps - Injected dependencies
 * @returns Pack information result
 * @throws ScaffoldError on lookup or validation failure
 */
export async function handlePackInfo(
  input: PackInfoInput,
  deps: PackInfoDependencies
): Promise<PackInfoResult> {
  const { packId, version } = input;
  const { registryFile, packsDir } = deps;

  // 1. Resolve pack version (supports multi-version selection)
  const resolver = new PackResolver(registryFile);
  const resolvedPack = await resolver.resolve(packId, version);

  // Build entry object from resolved pack
  const entry = {
    id: packId,
    version: resolvedPack.version,
    origin: resolvedPack.origin,
    hash: resolvedPack.hash,
    installedAt: resolvedPack.installedAt,
  };

  // 2. Derive and validate store path
  const storePath = deriveStorePath(packsDir, entry.id, entry.hash);

  try {
    await fs.access(storePath);
  } catch {
    throw new ScaffoldError(
      `Pack is registered but missing from store`,
      "PACK_STORE_MISSING",
      {
        packId,
        storePath,
        hash: entry.hash,
      },
      undefined,
      `Pack '${packId}' is registered but its files are missing from the store at ${storePath}. ` +
        `Try reinstalling the pack with \`scaffoldix pack add <path>\`.`,
      undefined,
      true
    );
  }

  // 4. Load manifest to get archetypes
  const manifestLoader = new ManifestLoader();
  let manifest: PackManifest;

  try {
    manifest = await manifestLoader.loadFromDir(storePath);
  } catch (err) {
    // Wrap manifest errors with store-specific context
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new ScaffoldError(
      `Failed to load manifest from installed pack`,
      "PACK_MANIFEST_CORRUPT",
      {
        packId,
        storePath,
      },
      undefined,
      `The installed pack at ${storePath} has a corrupted or missing manifest. ` +
        `Try reinstalling with \`scaffoldix pack add <original-source>\`.`,
      cause,
      true
    );
  }

  // Check pack compatibility with current CLI version
  validateCompatibility(manifest);

  // 5. Extract and sort archetypes
  const archetypes = manifest.archetypes
    .map((a) => a.id)
    .sort((a, b) => a.localeCompare(b));

  return {
    packId: entry.id,
    version: entry.version,
    origin: formatOrigin(entry.origin),
    originRaw: entry.origin,
    storePath,
    installedAt: entry.installedAt,
    hash: entry.hash,
    archetypes,
  };
}

/**
 * Formats the pack info result for CLI output.
 *
 * @param result - The pack info result
 * @returns Array of output lines
 */
export function formatPackInfoOutput(result: PackInfoResult): string[] {
  const lines: string[] = [];

  lines.push(`Pack: ${result.packId}`);
  lines.push(`Version: ${result.version}`);
  lines.push(`Origin: ${result.origin}`);
  lines.push(`Store path: ${result.storePath}`);
  lines.push(`Installed at: ${result.installedAt}`);
  lines.push(`Hash: ${result.hash}`);
  lines.push("");
  lines.push("Archetypes:");

  for (const archetype of result.archetypes) {
    lines.push(`  - ${archetype}`);
  }

  return lines;
}

// =============================================================================
// JSON Output
// =============================================================================

/**
 * JSON origin structure for pack info.
 */
interface JsonPackOrigin {
  type: "local" | "git" | "zip" | "npm";
  path?: string;
  url?: string;
  ref?: string;
  commit?: string;
}

/**
 * Converts the raw origin object to a JSON-friendly format.
 */
function toJsonOrigin(origin: PackOrigin): JsonPackOrigin {
  switch (origin.type) {
    case "local":
      return {
        type: "local",
        path: origin.localPath,
      };

    case "git":
      return {
        type: "git",
        url: origin.gitUrl,
        ref: origin.ref,
        commit: origin.commit,
      };

    case "zip":
      return {
        type: "zip",
        url: origin.zipUrl,
      };

    case "npm":
      return {
        type: "npm",
        path: origin.packageName,
      };

    default:
      // Future-proof
      return { type: "local", path: "unknown" };
  }
}

/**
 * Formats the pack info result as JSON.
 *
 * @param result - The pack info result
 * @returns JSON string
 */
export function formatPackInfoJson(result: PackInfoResult): string {
  const archetypes = result.archetypes.map((id) => ({
    id,
    templateRoot: `templates/${id}`,
  }));

  const output = {
    packId: result.packId,
    version: result.version,
    origin: toJsonOrigin(result.originRaw),
    storePath: result.storePath,
    installedAt: result.installedAt,
    archetypes,
  };

  return JSON.stringify(output, null, 2);
}
