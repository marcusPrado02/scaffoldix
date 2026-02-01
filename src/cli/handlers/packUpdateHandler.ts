/**
 * Handler for the `pack update` CLI command.
 *
 * This module handles updating Git-installed packs by:
 * - Fetching latest commits from the remote
 * - Detecting changes (commit/version)
 * - Installing updated pack to Store
 * - Maintaining update history in registry
 *
 * @module
 */

import * as path from "node:path";
import { ScaffoldError } from "../../core/errors/errors.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import {
  StoreService,
  type StoreServiceConfig,
  type StoreLogger,
} from "../../core/store/StoreService.js";
import { GitPackFetcher } from "../../core/store/GitPackFetcher.js";
import {
  RegistryService,
  type RegistryPackEntry,
  type PackOriginGit,
} from "../../core/registry/RegistryService.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the pack update handler.
 */
export interface PackUpdateInput {
  /** Pack ID to update */
  readonly packId: string;

  /** Optional ref override (branch, tag, or commit) */
  readonly ref?: string;
}

/**
 * Result of a pack update operation.
 */
export interface PackUpdateResult {
  /** Pack identifier */
  readonly packId: string;

  /** Update status */
  readonly status: "updated" | "already_up_to_date";

  /** Previous commit hash */
  readonly previousCommit: string;

  /** New commit hash */
  readonly newCommit: string;

  /** Previous version (if changed) */
  readonly previousVersion: string;

  /** New version (if changed) */
  readonly newVersion: string;

  /** New store path */
  readonly destDir: string;

  /** New manifest hash */
  readonly hash: string;
}

/**
 * Dependencies for the pack update handler.
 */
export interface PackUpdateDependencies {
  /** Store service configuration */
  readonly storeConfig: StoreServiceConfig;

  /** Logger for operation progress */
  readonly logger: StoreLogger;
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handles the `pack update <packId>` command.
 *
 * ## Process
 *
 * 1. Load registry and find pack entry
 * 2. Verify pack is git-based
 * 3. Clone/fetch to staging directory
 * 4. Compare commits - exit early if same
 * 5. Load manifest from staging
 * 6. Install updated pack to store
 * 7. Update registry with history
 *
 * @param input - Update input (packId, optional ref)
 * @param deps - Injected dependencies
 * @returns Update result
 * @throws ScaffoldError on failure
 */
export async function handlePackUpdate(
  input: PackUpdateInput,
  deps: PackUpdateDependencies,
): Promise<PackUpdateResult> {
  const { packId, ref } = input;
  const { storeConfig, logger } = deps;

  // 1. Load registry and find pack
  const registry = new RegistryService(storeConfig.registryFile);
  const packEntry = await registry.getPack(packId);

  if (!packEntry) {
    throw new ScaffoldError(
      `Pack '${packId}' not found`,
      "PACK_NOT_FOUND",
      { packId },
      undefined,
      `Pack '${packId}' is not installed. Run \`scaffoldix pack list\` to see installed packs.`,
      undefined,
      true,
    );
  }

  // 2. Verify pack is git-based
  if (packEntry.origin.type !== "git") {
    throw new ScaffoldError(
      `Pack '${packId}' is not Git-based and cannot be updated with \`pack update\``,
      "PACK_NOT_GIT_BASED",
      { packId, originType: packEntry.origin.type },
      undefined,
      `Pack '${packId}' was installed from ${packEntry.origin.type}, not from Git. ` +
        `Only Git-based packs can be updated. To update this pack, remove it and re-add from a Git URL.`,
      undefined,
      true,
    );
  }

  const gitOrigin = packEntry.origin as PackOriginGit;
  const gitUrl = gitOrigin.gitUrl;
  const effectiveRef = ref ?? gitOrigin.ref;

  logger.debug("Updating pack from git", {
    packId,
    url: gitUrl,
    currentCommit: gitOrigin.commit,
    ref: effectiveRef,
  });

  // 3. Clone to staging
  const fetcher = new GitPackFetcher(storeConfig.storeDir);
  const fetchResult = await fetcher.fetch(gitUrl, { ref: effectiveRef });

  try {
    const newCommit = fetchResult.commit;
    const previousCommit = gitOrigin.commit ?? "";

    // 4. Compare commits
    if (newCommit === previousCommit) {
      logger.info("Pack is already up to date", { packId, commit: newCommit });

      // Cleanup and return early
      await fetcher.cleanup(fetchResult);

      return {
        packId,
        status: "already_up_to_date",
        previousCommit,
        newCommit,
        previousVersion: packEntry.version,
        newVersion: packEntry.version,
        destDir: path.join(storeConfig.packsDir, packId, packEntry.hash),
        hash: packEntry.hash,
      };
    }

    // 5. Load manifest from staging
    const manifestLoader = new ManifestLoader();
    const manifest = await manifestLoader.loadFromDir(fetchResult.packDir);

    logger.debug("Loaded manifest from updated repo", {
      packName: manifest.pack.name,
      packVersion: manifest.pack.version,
      newCommit,
    });

    // 6. Install updated pack to store (skip registry, we'll handle it with history)
    const storeService = new StoreService(storeConfig, logger);
    const installResult = await storeService.installLocalPack({
      sourcePath: fetchResult.packDir,
      origin: {
        type: "git",
        gitUrl,
        commit: newCommit,
        ref: effectiveRef,
      },
      skipRegistryUpdate: true,
    });

    // 7. Update registry with history (preserves previous entry)
    await registry.updatePackWithHistory(packId, {
      id: packId,
      version: manifest.pack.version,
      origin: {
        type: "git",
        gitUrl,
        commit: newCommit,
        ref: effectiveRef,
      },
      hash: installResult.hash,
    });

    logger.info("Pack updated successfully", {
      packId,
      previousVersion: packEntry.version,
      newVersion: manifest.pack.version,
      previousCommit,
      newCommit,
      destDir: installResult.destDir,
    });

    return {
      packId,
      status: "updated",
      previousCommit,
      newCommit,
      previousVersion: packEntry.version,
      newVersion: manifest.pack.version,
      destDir: installResult.destDir,
      hash: installResult.hash,
    };
  } finally {
    // Always cleanup staging
    await fetcher.cleanup(fetchResult);
  }
}

/**
 * Formats a successful pack update result for CLI output.
 *
 * @param result - The update result
 * @returns Human-readable message lines
 */
export function formatPackUpdateSuccess(result: PackUpdateResult): string[] {
  if (result.status === "already_up_to_date") {
    return [
      `Pack is already up to date`,
      `  Pack: ${result.packId}@${result.newVersion}`,
      `  Commit: ${result.newCommit.slice(0, 7)}`,
    ];
  }

  const lines = [
    `Updated pack ${result.packId}`,
    `  Version: ${result.previousVersion} → ${result.newVersion}`,
    `  Commit: ${result.previousCommit.slice(0, 7)} → ${result.newCommit.slice(0, 7)}`,
    `  Location: ${result.destDir}`,
  ];

  return lines;
}
