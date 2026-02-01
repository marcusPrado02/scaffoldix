/**
 * Handler for the `pack remove` CLI command.
 *
 * This module contains the orchestration logic for removing a pack from the
 * Scaffoldix Store. It coordinates between:
 * - RegistryService for pack lookup and registry updates
 * - Filesystem operations for safe directory removal
 *
 * The handler is separated from the CLI wiring to enable direct testing.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScaffoldError } from "../../core/errors/errors.js";
import { RegistryService } from "../../core/registry/RegistryService.js";
import type { StoreLogger } from "../../core/store/StoreService.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the pack remove handler.
 */
export interface PackRemoveInput {
  /** Pack ID to remove */
  readonly packId: string;
}

/**
 * Result of a successful pack removal.
 */
export interface PackRemoveResult {
  /** Pack identifier that was removed */
  readonly packId: string;

  /** Pack version that was removed */
  readonly version: string;

  /** SHA-256 hash of the removed pack manifest */
  readonly hash: string;

  /** Absolute path that was removed from store */
  readonly removedPath: string;

  /** Status of the removal operation */
  readonly status: "removed";
}

/**
 * Dependencies for the pack remove handler.
 */
export interface PackRemoveDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;

  /** Absolute path to the packs directory */
  readonly packsDir: string;

  /** Logger for operation progress */
  readonly logger: StoreLogger;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sanitizes a pack ID for use in filesystem paths.
 * Must match StoreService.sanitizePackId exactly.
 */
function sanitizePackId(packId: string): string {
  return packId
    .replace(/\//g, "__") // Replace / with __ (scoped packages)
    .replace(/[<>:"|?*]/g, "_"); // Replace Windows-unsafe chars
}

/**
 * Checks if a path is safely inside the allowed parent directory.
 *
 * @param targetPath - The path to check
 * @param allowedParent - The parent directory that must contain targetPath
 * @returns true if targetPath is safely inside allowedParent
 */
function isPathInsideDir(targetPath: string, allowedParent: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedParent = path.resolve(allowedParent);

  // Ensure parent ends with separator for accurate prefix matching
  const normalizedParent = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : resolvedParent + path.sep;

  return resolvedTarget.startsWith(normalizedParent);
}

/**
 * Removes a directory if it's empty.
 *
 * @param dirPath - Directory to potentially remove
 * @returns true if directory was removed, false if it had contents
 */
async function removeIfEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath);
    if (entries.length === 0) {
      await fs.rmdir(dirPath);
      return true;
    }
    return false;
  } catch {
    // Directory doesn't exist or other error - that's fine
    return false;
  }
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handles the `pack remove <packId>` command.
 *
 * ## Process
 *
 * 1. Load registry and find pack entry
 * 2. Validate the pack exists (clear error if not)
 * 3. Compute store path and verify it's inside packsDir (safety check)
 * 4. Delete the pack directory from store (if it exists)
 * 5. Update registry to remove pack entry (atomic)
 * 6. Optionally prune empty parent directory
 *
 * ## Safety Guarantees
 *
 * - Never deletes paths outside packsDir
 * - Registry is only updated after successful deletion (or if path doesn't exist)
 * - Handles orphaned registry entries gracefully
 *
 * @param input - User input (packId to remove)
 * @param deps - Injected dependencies (registry file, packsDir, logger)
 * @returns Result with removed pack details
 * @throws ScaffoldError on pack not found or security violation
 */
export async function handlePackRemove(
  input: PackRemoveInput,
  deps: PackRemoveDependencies,
): Promise<PackRemoveResult> {
  const { packId } = input;
  const { registryFile, packsDir, logger } = deps;

  // 1. Load registry and find pack
  const registryService = new RegistryService(registryFile);
  const packEntry = await registryService.getPack(packId);

  // 2. Validate pack exists
  if (!packEntry) {
    throw new ScaffoldError(
      `Pack '${packId}' is not installed`,
      "PACK_NOT_FOUND",
      { packId },
      undefined,
      `Pack '${packId}' is not installed. Run \`scaffoldix pack list\` to see installed packs.`,
      undefined,
      true,
    );
  }

  logger.debug("Found pack in registry", {
    packId,
    version: packEntry.version,
    hash: packEntry.hash,
  });

  // 3. Compute store path and verify safety
  const sanitizedId = sanitizePackId(packId);
  const storePath = path.join(packsDir, sanitizedId, packEntry.hash);

  if (!isPathInsideDir(storePath, packsDir)) {
    throw new ScaffoldError(
      `Refusing to delete path outside of store: ${storePath}`,
      "PACK_REMOVE_SECURITY_ERROR",
      { packId, storePath, packsDir },
      undefined,
      `The computed store path "${storePath}" is outside the packs directory. ` +
        `This may indicate registry corruption. Please manually verify and repair.`,
      undefined,
      true,
    );
  }

  // 4. Delete pack directory from store
  let pathExisted = false;
  try {
    await fs.access(storePath);
    pathExisted = true;
  } catch {
    // Path doesn't exist - will log warning but continue
  }

  if (pathExisted) {
    logger.debug("Removing pack directory", { storePath });
    await fs.rm(storePath, { recursive: true, force: true });
  } else {
    logger.warn("Pack directory does not exist (orphaned registry entry)", {
      packId,
      expectedPath: storePath,
    });
  }

  // 5. Update registry (remove pack entry)
  await registryService.unregisterPack(packId);

  logger.info("Pack removed successfully", {
    packId,
    version: packEntry.version,
    hash: packEntry.hash,
    storePath,
  });

  // 6. Prune empty parent directory (packId dir)
  const packIdDir = path.join(packsDir, sanitizedId);
  await removeIfEmpty(packIdDir);

  return {
    packId,
    version: packEntry.version,
    hash: packEntry.hash,
    removedPath: storePath,
    status: "removed",
  };
}

/**
 * Formats a successful pack removal result for CLI output.
 *
 * @param result - The pack removal result
 * @returns Human-readable message lines
 */
export function formatPackRemoveSuccess(result: PackRemoveResult): string[] {
  return [
    `Removed pack ${result.packId}@${result.version}`,
    `  Path: ${result.removedPath}`,
    `  Hash: ${result.hash}`,
  ];
}
