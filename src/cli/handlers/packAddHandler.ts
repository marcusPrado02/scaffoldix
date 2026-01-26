/**
 * Handler for the `pack add` CLI command.
 *
 * This module contains the orchestration logic for adding a local pack
 * to the Scaffoldix Store. It coordinates between:
 * - Path validation
 * - ManifestLoader (T4)
 * - StoreService (T5)
 *
 * The handler is separated from the CLI wiring to enable direct testing.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ScaffoldError } from "../../core/errors/errors.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import {
  StoreService,
  type StoreServiceConfig,
  type StoreLogger,
} from "../../core/store/StoreService.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the pack add handler.
 */
export interface PackAddInput {
  /** Path to the pack directory (can be relative or absolute) */
  readonly packPath: string;

  /** Current working directory for resolving relative paths */
  readonly cwd: string;
}

/**
 * Result of a successful pack add operation.
 */
export interface PackAddResult {
  /** Pack identifier from manifest */
  readonly packId: string;

  /** Pack version from manifest */
  readonly version: string;

  /** SHA-256 hash of manifest (content identity) */
  readonly hash: string;

  /** Absolute path where pack was installed */
  readonly destDir: string;

  /** Original source path (absolute) */
  readonly sourcePath: string;

  /** Whether pack was freshly installed or already existed */
  readonly status: "installed" | "already_installed";
}

/**
 * Dependencies for the pack add handler.
 *
 * Using dependency injection allows:
 * - Testing with mock services
 * - CLI to provide real services with proper paths
 */
export interface PackAddDependencies {
  /** Store service configuration (paths from T2) */
  readonly storeConfig: StoreServiceConfig;

  /** Logger for operation progress */
  readonly logger: StoreLogger;
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Handles the `pack add <path>` command.
 *
 * ## Process
 *
 * 1. Resolve the provided path to an absolute path
 * 2. Validate the path exists and is a directory
 * 3. Load and validate the pack manifest
 * 4. Install the pack into the Store
 * 5. Return the result (installed vs already_installed)
 *
 * ## Error Handling
 *
 * All errors are wrapped in ScaffoldError with:
 * - Clear, actionable message
 * - Error code for programmatic handling
 * - Hint for user guidance
 *
 * @param input - User input (pack path and cwd)
 * @param deps - Injected dependencies (store config, logger)
 * @returns Result with pack details and installation status
 * @throws ScaffoldError on validation or installation failure
 */
export async function handlePackAdd(
  input: PackAddInput,
  deps: PackAddDependencies
): Promise<PackAddResult> {
  const { packPath, cwd } = input;
  const { storeConfig, logger } = deps;

  // 1. Resolve to absolute path
  const resolvedPath = path.isAbsolute(packPath)
    ? path.normalize(packPath)
    : path.resolve(cwd, packPath);

  logger.debug("Resolving pack path", {
    provided: packPath,
    resolved: resolvedPath,
    cwd,
  });

  // 2. Validate path exists
  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (error) {
    throw new ScaffoldError(
      `Pack path not found: ${packPath}`,
      "PACK_PATH_NOT_FOUND",
      {
        providedPath: packPath,
        resolvedPath: resolvedPath,
      },
      undefined,
      `The path "${packPath}" does not exist (resolved to "${resolvedPath}"). ` +
        `Verify the path is correct and the directory exists.`,
      error instanceof Error ? error : undefined,
      true
    );
  }

  // 3. Validate it's a directory
  if (!stats.isDirectory()) {
    const isFile = stats.isFile();
    const hint = isFile
      ? `"${packPath}" is a file, not a directory. ` +
        `Use the parent directory containing archetype.yaml instead.`
      : `"${packPath}" is not a directory.`;

    throw new ScaffoldError(
      `Expected a directory: ${packPath}`,
      "PACK_NOT_DIRECTORY",
      {
        providedPath: packPath,
        resolvedPath: resolvedPath,
        isFile,
      },
      undefined,
      hint,
      undefined,
      true
    );
  }

  logger.debug("Pack path validated", { resolvedPath });

  // 4. Load and validate manifest (ManifestLoader handles errors)
  const manifestLoader = new ManifestLoader();
  const manifest = await manifestLoader.loadFromDir(resolvedPath);

  logger.debug("Manifest loaded", {
    packName: manifest.pack.name,
    packVersion: manifest.pack.version,
    manifestPath: manifest.manifestPath,
  });

  // 5. Install pack into Store (StoreService handles registry update)
  const storeService = new StoreService(storeConfig, logger);
  const installResult = await storeService.installLocalPack({
    sourcePath: resolvedPath,
  });

  return {
    packId: installResult.packId,
    version: installResult.version,
    hash: installResult.hash,
    destDir: installResult.destDir,
    sourcePath: resolvedPath,
    status: installResult.status,
  };
}

/**
 * Formats a successful pack add result for CLI output.
 *
 * @param result - The pack add result
 * @returns Human-readable message lines
 */
export function formatPackAddSuccess(result: PackAddResult): string[] {
  if (result.status === "already_installed") {
    return [
      `Pack already installed; skipping`,
      `  Pack: ${result.packId}@${result.version}`,
      `  Location: ${result.destDir}`,
      `  Hash: ${result.hash}`,
    ];
  }

  return [
    `Installed pack ${result.packId}@${result.version}`,
    `  From: ${result.sourcePath}`,
    `  To: ${result.destDir}`,
    `  Hash: ${result.hash}`,
  ];
}
