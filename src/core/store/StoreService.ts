/**
 * Store Service for Scaffoldix CLI.
 *
 * The Store Service handles installation of packs into the internal Store.
 * It provides deterministic, idempotent installation from various sources,
 * starting with local filesystem paths.
 *
 * ## Installation Guarantees
 *
 * - **Deterministic**: Same pack inputs always produce the same output location
 * - **Idempotent**: Installing the same pack twice does not duplicate data
 * - **Atomic**: Partial installs never leave corrupted state (staging + rename)
 * - **Integrity**: Pack contents are verified via manifest hash
 *
 * ## Directory Structure
 *
 * Packs are installed to: `<packsDir>/<packId>/<hash>/`
 *
 * This structure ensures:
 * - Same pack + same content → same destDir
 * - Different content → different destDir (via hash)
 * - Multiple versions can coexist
 *
 * ## Coordination with Registry
 *
 * The Store Service works closely with the Registry Service:
 * 1. Check registry BEFORE install (skip if already installed)
 * 2. Update registry AFTER successful install
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScaffoldError } from "../errors/errors.js";
import {
  RegistryService,
  type RegisterPackInput,
  type PackOrigin,
} from "../registry/RegistryService.js";
import { ManifestLoader, type PackManifest } from "../manifest/ManifestLoader.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for installing a pack from a local filesystem path.
 */
export interface InstallLocalPackInput {
  /** Absolute path to the pack source directory */
  readonly sourcePath: string;

  /**
   * Optional origin metadata to use instead of defaulting to "local".
   * This allows git-cloned packs to be installed with git origin info.
   */
  readonly origin?: PackOrigin;

  /**
   * If true, skip the registry update step.
   * Used when the caller will handle registry updates separately
   * (e.g., pack update with history tracking).
   */
  readonly skipRegistryUpdate?: boolean;
}

/**
 * Result of a successful pack installation.
 */
export interface InstallPackResult {
  /** Pack identifier (derived from manifest) */
  readonly packId: string;

  /** Pack version (from manifest) */
  readonly version: string;

  /** SHA-256 hash of the manifest (content integrity) */
  readonly hash: string;

  /** Absolute path to the installed pack directory */
  readonly destDir: string;

  /** Whether the pack was freshly installed or already existed */
  readonly status: "installed" | "already_installed";
}

/**
 * Logger interface for dependency injection.
 *
 * This allows the StoreService to log without depending on a specific
 * logger implementation. CLI can provide its Logger, tests can provide
 * a mock or no-op logger.
 */
export interface StoreLogger {
  info(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>, data?: Record<string, unknown>): void;
}

/**
 * Configuration for the Store Service.
 */
export interface StoreServiceConfig {
  /** Root directory of the store (e.g., ~/.local/share/scaffoldix) */
  readonly storeDir: string;

  /** Directory where packs are installed (e.g., <storeDir>/packs) */
  readonly packsDir: string;

  /** Absolute path to the registry file */
  readonly registryFile: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Files and directories to exclude when copying packs.
 *
 * These are transient or environment-specific files that should not be
 * included in installed packs:
 * - node_modules: Dependencies should be installed fresh
 * - .git: Version control history is not needed
 * - OS cruft: Platform-specific metadata files
 */
const EXCLUDED_ITEMS = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "Thumbs.db",
  ".Trashes",
  "desktop.ini",
]);

/**
 * Name of the staging directory for atomic installs.
 */
const STAGING_DIR_NAME = ".tmp";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sanitizes a pack ID for use in filesystem paths.
 *
 * Handles:
 * - Scoped packages (@org/name → @org__name)
 * - Characters unsafe on Windows (: ? * " < > |)
 * - Preserves readability where possible
 *
 * @param packId - Original pack identifier
 * @returns Filesystem-safe version of the ID
 */
function sanitizePackId(packId: string): string {
  return packId
    .replace(/\//g, "__") // Replace / with __ (scoped packages)
    .replace(/[<>:"|?*]/g, "_"); // Replace Windows-unsafe chars
}

/**
 * Computes SHA-256 hash of a file's contents.
 *
 * @param filePath - Absolute path to the file
 * @returns 64-character lowercase hex hash
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Generates a unique staging directory path.
 *
 * @param storeDir - Store root directory
 * @returns Path to a unique staging directory
 */
function getStagingDirPath(storeDir: string): string {
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return path.join(storeDir, STAGING_DIR_NAME, `install-${randomSuffix}`);
}

/**
 * Recursively copies a directory, excluding specified items.
 *
 * @param src - Source directory
 * @param dest - Destination directory
 * @param excludes - Set of filenames to exclude
 */
async function copyDirectoryFiltered(
  src: string,
  dest: string,
  excludes: Set<string>,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (excludes.has(entry.name)) {
      continue; // Skip excluded items
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryFiltered(srcPath, destPath, excludes);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks
      const linkTarget = await fs.readlink(srcPath);
      await fs.symlink(linkTarget, destPath);
    }
    // Skip other types (block devices, sockets, etc.)
  }
}

/**
 * Creates a no-op logger for when no logger is provided.
 */
function createNoopLogger(): StoreLogger {
  return {
    info: () => {},
    debug: () => {},
    warn: () => {},
  };
}

// =============================================================================
// StoreService Class
// =============================================================================

/**
 * Service for managing pack installation in the Scaffoldix Store.
 *
 * @example
 * ```typescript
 * import { StoreService } from "./core/store/StoreService.js";
 * import { initStorePaths } from "./core/utils/paths.js";
 * import { Logger } from "./core/logger/logger.js";
 *
 * const paths = initStorePaths();
 * const logger = new Logger();
 * const store = new StoreService({
 *   storeDir: paths.storeDir,
 *   packsDir: paths.packsDir,
 *   registryFile: paths.registryFile,
 * }, logger);
 *
 * // Install a pack from local directory
 * const result = await store.installLocalPack({
 *   sourcePath: "/path/to/my-pack",
 * });
 *
 * console.log(result.destDir); // Where the pack was installed
 * ```
 */
export class StoreService {
  private readonly registryService: RegistryService;
  private readonly manifestLoader: ManifestLoader;
  private readonly logger: StoreLogger;

  /**
   * Creates a new StoreService instance.
   *
   * @param config - Store configuration (paths from paths module)
   * @param logger - Optional logger for install progress (defaults to no-op)
   */
  constructor(
    private readonly config: StoreServiceConfig,
    logger?: StoreLogger,
  ) {
    // Validate config paths are absolute
    if (!path.isAbsolute(config.storeDir)) {
      throw new ScaffoldError(
        "Store directory path must be absolute",
        "STORE_INVALID_CONFIG",
        { path: config.storeDir, field: "storeDir" },
        undefined,
        "The storeDir provided to StoreService must be an absolute path.",
        undefined,
        false, // programming error
      );
    }

    if (!path.isAbsolute(config.packsDir)) {
      throw new ScaffoldError(
        "Packs directory path must be absolute",
        "STORE_INVALID_CONFIG",
        { path: config.packsDir, field: "packsDir" },
        undefined,
        "The packsDir provided to StoreService must be an absolute path.",
        undefined,
        false, // programming error
      );
    }

    if (!path.isAbsolute(config.registryFile)) {
      throw new ScaffoldError(
        "Registry file path must be absolute",
        "STORE_INVALID_CONFIG",
        { path: config.registryFile, field: "registryFile" },
        undefined,
        "The registryFile provided to StoreService must be an absolute path.",
        undefined,
        false, // programming error
      );
    }

    this.registryService = new RegistryService(config.registryFile);
    this.manifestLoader = new ManifestLoader();
    this.logger = logger ?? createNoopLogger();
  }

  /**
   * Installs a pack from a local filesystem path into the Store.
   *
   * ## Process
   *
   * 1. Load and validate the pack manifest
   * 2. Compute manifest hash for content identity
   * 3. Determine pack ID and destination directory
   * 4. Check registry - skip if already installed (idempotent)
   * 5. Copy pack to staging directory (filtered, excludes junk)
   * 6. Atomically move staging → destination
   * 7. Update registry on success
   *
   * ## Idempotency
   *
   * If the exact same pack (same manifest hash) is already installed,
   * this method returns immediately without copying files. The result
   * will have `status: "already_installed"`.
   *
   * @param input - Installation input with source path
   * @returns Installation result with pack details and destination
   * @throws ScaffoldError if manifest invalid, copy fails, etc.
   */
  async installLocalPack(input: InstallLocalPackInput): Promise<InstallPackResult> {
    const { sourcePath } = input;

    // Validate source path
    if (!path.isAbsolute(sourcePath)) {
      throw new ScaffoldError(
        "Source path must be absolute",
        "STORE_INVALID_SOURCE",
        { sourcePath },
        undefined,
        `The path "${sourcePath}" is not absolute. Provide a full path to the pack directory.`,
        undefined,
        true,
      );
    }

    // 1. Load and validate manifest
    this.logger.debug("Loading manifest", { sourcePath });
    const manifest = await this.manifestLoader.loadFromDir(sourcePath);

    // 2. Compute manifest hash (content identity)
    const hash = await computeFileHash(manifest.manifestPath);

    // 3. Determine pack identity
    const packId = manifest.pack.name;
    const version = manifest.pack.version;
    const sanitizedId = sanitizePackId(packId);

    // 4. Determine destination directory (deterministic)
    const destDir = path.join(this.config.packsDir, sanitizedId, hash);

    this.logger.debug("Computed pack identity", {
      packId,
      version,
      hash,
      destDir,
    });

    // 5. Check registry for existing installation (including multi-version installs)
    const existingEntry = await this.registryService.getPack(packId);

    if (existingEntry) {
      // Check top-level hash and installs array for matching hash
      const existingInstalls = existingEntry.installs ?? [];
      const hashExists =
        existingEntry.hash === hash || existingInstalls.some((i) => i.hash === hash);

      if (hashExists) {
        this.logger.info("Pack already installed (skipped)", {
          packId,
          version,
          hash,
          destDir,
          sourcePath,
        });

        return {
          packId,
          version,
          hash,
          destDir,
          status: "already_installed",
        };
      }
    }

    // 6. Perform installation with atomic staging
    await this.performAtomicInstall(sourcePath, destDir, manifest);

    // 7. Update registry (unless caller will handle it separately)
    if (!input.skipRegistryUpdate) {
      const registerInput: RegisterPackInput = {
        id: packId,
        version,
        origin: input.origin ?? { type: "local", localPath: sourcePath },
        hash,
      };

      // Use registerPackVersion to preserve existing versions
      await this.registryService.registerPackVersion(registerInput);
    }

    this.logger.info("Pack installed successfully", {
      packId,
      version,
      hash,
      destDir,
      sourcePath,
    });

    return {
      packId,
      version,
      hash,
      destDir,
      status: "installed",
    };
  }

  /**
   * Performs the atomic installation of a pack.
   *
   * Uses a staging directory strategy:
   * 1. Copy to staging dir (inside store)
   * 2. Rename staging → destination (atomic on same filesystem)
   *
   * If anything fails, the staging directory is cleaned up.
   *
   * @param sourcePath - Source pack directory
   * @param destDir - Final destination directory
   * @param manifest - Loaded manifest (for error context)
   */
  private async performAtomicInstall(
    sourcePath: string,
    destDir: string,
    manifest: PackManifest,
  ): Promise<void> {
    const stagingDir = getStagingDirPath(this.config.storeDir);

    try {
      // Ensure staging parent directory exists
      await fs.mkdir(path.dirname(stagingDir), { recursive: true });

      // Copy to staging (filtered)
      this.logger.debug("Copying to staging", { sourcePath, stagingDir });
      await copyDirectoryFiltered(sourcePath, stagingDir, EXCLUDED_ITEMS);

      // Ensure destination parent exists
      await fs.mkdir(path.dirname(destDir), { recursive: true });

      // Check if destination already exists (race condition guard)
      try {
        await fs.access(destDir);
        // Destination exists - another process may have installed it
        // Clean up staging and treat as already installed
        await fs.rm(stagingDir, { recursive: true, force: true });
        this.logger.debug("Destination already exists (concurrent install)", { destDir });
        return;
      } catch {
        // Destination doesn't exist - proceed with rename
      }

      // Atomic rename staging → destination
      this.logger.debug("Moving staging to destination", { stagingDir, destDir });
      await fs.rename(stagingDir, destDir);
    } catch (error) {
      // Clean up staging on failure
      try {
        await fs.rm(stagingDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      const cause = error instanceof Error ? error : new Error(String(error));

      throw new ScaffoldError(
        "Failed to install pack",
        "STORE_INSTALL_FAILED",
        {
          sourcePath,
          destDir,
          packId: manifest.pack.name,
          version: manifest.pack.version,
          reason: cause.message,
        },
        undefined,
        `Could not install pack "${manifest.pack.name}" to ${destDir}. ${cause.message}`,
        cause,
        true,
      );
    }
  }

  /**
   * Gets the destination directory path for a pack without installing.
   *
   * Useful for checking where a pack would be installed or verifying
   * installation status.
   *
   * @param packId - Pack identifier
   * @param hash - Manifest hash
   * @returns Absolute path to where the pack would be installed
   */
  getPackDestDir(packId: string, hash: string): string {
    const sanitizedId = sanitizePackId(packId);
    return path.join(this.config.packsDir, sanitizedId, hash);
  }
}
