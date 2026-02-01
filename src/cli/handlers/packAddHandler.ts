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
import { ManifestLoader, type PackManifest } from "../../core/manifest/ManifestLoader.js";
import {
  StoreService,
  type StoreServiceConfig,
  type StoreLogger,
} from "../../core/store/StoreService.js";
import { GitPackFetcher } from "../../core/store/GitPackFetcher.js";
import { CompatibilityChecker } from "../../core/compatibility/CompatibilityChecker.js";
import { CLI_VERSION } from "../version.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the pack add handler.
 */
export interface PackAddInput {
  /** Path to the pack directory or git URL */
  readonly packPath: string;

  /** Current working directory for resolving relative paths */
  readonly cwd: string;

  /**
   * Whether the packPath is a git URL.
   * If true, the pack will be cloned from the URL.
   * If not provided, auto-detection is used.
   */
  readonly isGitUrl?: boolean;

  /**
   * Git ref to checkout (branch, tag, or commit hash).
   * Only used when installing from a git URL.
   */
  readonly ref?: string;
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
 * For local paths:
 * 1. Resolve the provided path to an absolute path
 * 2. Validate the path exists and is a directory
 * 3. Load and validate the pack manifest
 * 4. Install the pack into the Store
 * 5. Return the result (installed vs already_installed)
 *
 * For git URLs:
 * 1. Clone repository to temp directory
 * 2. Optionally checkout specific ref
 * 3. Load and validate the pack manifest
 * 4. Install with git origin metadata
 * 5. Clean up temp directory
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
  deps: PackAddDependencies,
): Promise<PackAddResult> {
  const { packPath, cwd, ref } = input;
  const { storeConfig, logger } = deps;

  // Determine if this is a git URL
  const isGitUrl = input.isGitUrl ?? GitPackFetcher.isGitUrl(packPath);

  if (isGitUrl) {
    return handleGitPackAdd(packPath, ref, storeConfig, logger);
  }

  return handleLocalPackAdd(packPath, cwd, storeConfig, logger);
}

/**
 * Handles adding a pack from a git URL.
 */
async function handleGitPackAdd(
  url: string,
  ref: string | undefined,
  storeConfig: StoreServiceConfig,
  logger: StoreLogger,
): Promise<PackAddResult> {
  const fetcher = new GitPackFetcher(storeConfig.storeDir);

  logger.debug("Cloning git repository", { url, ref });

  // Clone the repository
  const fetchResult = await fetcher.fetch(url, { ref });

  try {
    // Load and validate manifest from cloned directory
    const manifestLoader = new ManifestLoader();
    const manifest = await manifestLoader.loadFromDir(fetchResult.packDir);

    logger.debug("Manifest loaded from git clone", {
      packName: manifest.pack.name,
      packVersion: manifest.pack.version,
      commit: fetchResult.commit,
    });

    // Check pack compatibility with current CLI version
    validateCompatibility(manifest);

    // Install pack with git origin metadata
    const storeService = new StoreService(storeConfig, logger);
    const installResult = await storeService.installLocalPack({
      sourcePath: fetchResult.packDir,
      origin: {
        type: "git",
        gitUrl: url,
        commit: fetchResult.commit,
        ref: fetchResult.ref,
      },
    });

    return {
      packId: installResult.packId,
      version: installResult.version,
      hash: installResult.hash,
      destDir: installResult.destDir,
      sourcePath: url,
      status: installResult.status,
    };
  } finally {
    // Always clean up the temp directory
    await fetcher.cleanup(fetchResult);
  }
}

/**
 * Handles adding a pack from a local filesystem path.
 */
async function handleLocalPackAdd(
  packPath: string,
  cwd: string,
  storeConfig: StoreServiceConfig,
  logger: StoreLogger,
): Promise<PackAddResult> {
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
      true,
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
      true,
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

  // Check pack compatibility with current CLI version
  validateCompatibility(manifest);

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
      true,
    );
  }
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
