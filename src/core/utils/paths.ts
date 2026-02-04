/**
 * Store Path Resolution for Scaffoldix CLI.
 *
 * This module defines the boundaries and paths of the Scaffoldix Store - the internal,
 * CLI-managed area where ALL installed packs and their metadata live.
 *
 * ## What is the Store?
 *
 * The Store is a first-class architectural concept in Scaffoldix, not just a folder.
 * It represents the global, user-level repository of installed template packs that can
 * be used across multiple projects. Think of it like npm's global cache or Homebrew's Cellar.
 *
 * The Store owns:
 * - Physical storage of all installed packs (`<storeDir>/packs/<pack-name>/`)
 * - Registry metadata tracking installed packs (`<storeDir>/registry.json`)
 * - Any future store-level metadata (migrations, versions, etc.)
 *
 * ## Store vs Project State
 *
 * Scaffoldix separates concerns between:
 *
 * 1. **Store** (this module) - Global, user-level, managed by CLI:
 *    - Lives in platform-appropriate data directory (e.g., `~/.local/share/scaffoldix`)
 *    - Contains installed packs and registry
 *    - Shared across all projects
 *    - Managed exclusively by the Scaffoldix CLI engine
 *
 * 2. **Project State** (not this module) - Per-project, lives in repository:
 *    - Lives in `.scaffoldix/state.json` within a project
 *    - Tracks which packs/templates were applied to this project
 *    - Version-controlled with the project
 *    - Enables reproducibility and auditing
 *
 * This separation ensures that:
 * - Packs are downloaded once and reused across projects (efficiency)
 * - Project state is portable and doesn't depend on global machine state
 * - The Store can be migrated/upgraded independently of projects
 *
 * ## Why env-paths?
 *
 * We use `env-paths` instead of custom OS detection because:
 *
 * 1. **Platform conventions matter**: Users expect apps to respect their OS:
 *    - Linux: XDG Base Directory Specification (`~/.local/share/scaffoldix`)
 *    - macOS: Application Support (`~/Library/Application Support/scaffoldix`)
 *    - Windows: AppData Roaming (`%APPDATA%\scaffoldix`)
 *
 * 2. **Hardcoded paths are wrong**: Patterns like `~/.scaffoldix` violate XDG on
 *    Linux and are incorrect on Windows (where ~ expansion varies).
 *
 * 3. **Battle-tested**: env-paths is a zero-dependency, well-tested solution used
 *    by major CLIs (npm, yarn, pnpm, etc.). No need to reinvent OS detection.
 *
 * 4. **User overrides**: env-paths respects XDG_DATA_HOME on Linux, allowing power
 *    users to relocate their data directories.
 *
 * ## Encapsulation Guarantee
 *
 * All knowledge about where the Store lives is centralized in THIS module.
 * Other parts of the system (StoreService, RegistryService, CLI commands) must:
 * - ONLY consume the resolved paths from this module
 * - NEVER construct store paths manually
 * - NEVER assume store location based on OS detection
 *
 * This ensures that if we ever need to change store location logic (e.g., for
 * portable installs, custom overrides, or version migrations), we change ONE place.
 *
 * ## Stability Promise
 *
 * This module is designed to be stable enough that future features can rely on it:
 * - Pack update/removal operations
 * - Store migration between versions
 * - Store inspection/cleanup commands
 * - Multi-version pack storage
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs";
import envPaths from "env-paths";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved paths for the Scaffoldix Store.
 *
 * All paths are:
 * - Absolute (no relative paths)
 * - Normalized for the current platform (forward slashes on Unix, backslashes on Windows)
 * - Frozen (immutable after creation)
 *
 * @example
 * ```typescript
 * // Linux
 * {
 *   storeDir: "/home/user/.local/share/scaffoldix",
 *   packsDir: "/home/user/.local/share/scaffoldix/packs",
 *   registryFile: "/home/user/.local/share/scaffoldix/registry.json"
 * }
 *
 * // macOS
 * {
 *   storeDir: "/Users/user/Library/Application Support/scaffoldix",
 *   packsDir: "/Users/user/Library/Application Support/scaffoldix/packs",
 *   registryFile: "/Users/user/Library/Application Support/scaffoldix/registry.json"
 * }
 *
 * // Windows
 * {
 *   storeDir: "C:\\Users\\user\\AppData\\Roaming\\scaffoldix",
 *   packsDir: "C:\\Users\\user\\AppData\\Roaming\\scaffoldix\\packs",
 *   registryFile: "C:\\Users\\user\\AppData\\Roaming\\scaffoldix\\registry.json"
 * }
 * ```
 */
export interface StorePaths {
  /**
   * Root directory of the Scaffoldix Store.
   *
   * This is the top-level directory that contains all store-managed data.
   * Everything owned by the Store lives under this path.
   *
   * The Store owns this directory completely - no other application should
   * write here, and Scaffoldix should not assume anything about sibling
   * directories.
   */
  readonly storeDir: string;

  /**
   * Directory where installed packs are stored.
   *
   * Each installed pack gets its own subdirectory under this path:
   * `<packsDir>/<pack-name>/`
   *
   * This is always a direct child of `storeDir`.
   *
   * @example `<storeDir>/packs/react-starter/`
   * @example `<storeDir>/packs/@org/private-pack/`
   */
  readonly packsDir: string;

  /**
   * Absolute path to the registry metadata file.
   *
   * The registry tracks all installed packs and their metadata:
   * - Pack names and versions
   * - Installation timestamps
   * - Source URLs
   * - Integrity hashes
   *
   * This file is always located directly inside `storeDir` (not in a subdirectory).
   * Format: JSON
   *
   * @example `<storeDir>/registry.json`
   */
  readonly registryFile: string;

  /**
   * Root directory for cache storage.
   *
   * Used for caching computed data that can be regenerated if lost.
   * This is always a direct child of `storeDir`.
   *
   * @example `<storeDir>/cache/`
   */
  readonly cacheDir: string;

  /**
   * Directory for pack index cache.
   *
   * Stores cached PackIndex entries to speed up pack listing and lookups.
   * Each pack gets a JSON file with its cached metadata.
   *
   * @example `<storeDir>/cache/packs/`
   */
  readonly packsCacheDir: string;
}

/**
 * Options for Store initialization.
 */
export interface InitStoreOptions {
  /**
   * If true, required directories will be created if they don't exist.
   *
   * When enabled:
   * - Creates `storeDir` if missing
   * - Creates `packsDir` if missing
   * - Does NOT create `registryFile` (that's RegistryService's job)
   *
   * @default true
   */
  readonly ensureDirectories?: boolean;
}

// =============================================================================
// Internal State
// =============================================================================

/**
 * Cached paths instance.
 *
 * Once resolved, paths are cached for the lifetime of the process.
 * This ensures consistency and avoids repeated filesystem operations.
 */
let cachedPaths: StorePaths | null = null;

// =============================================================================
// Internal Functions
// =============================================================================

/**
 * Resolves Store paths using env-paths conventions.
 *
 * This is a pure computation with no side effects - it only determines
 * WHERE paths should be, not whether they exist.
 *
 * @returns Resolved and frozen paths object
 * @internal
 */
function resolveStorePaths(): StorePaths {
  // env-paths returns platform-appropriate directories
  // suffix: "" prevents adding "-nodejs" suffix to the directory name
  const envPathsResult = envPaths("scaffoldix", { suffix: "" });

  // Use the 'data' directory as our Store root
  // env-paths provides: data, config, cache, log, temp
  // 'data' is correct for persistent user data (packs are user data)
  const storeDir = path.normalize(envPathsResult.data);

  // Packs directory is a direct child of storeDir
  const packsDir = path.join(storeDir, "packs");

  // Registry file lives at the root of the store
  const registryFile = path.join(storeDir, "registry.json");

  // Cache directories
  const cacheDir = path.join(storeDir, "cache");
  const packsCacheDir = path.join(cacheDir, "packs");

  // Return frozen object to prevent accidental mutation
  return Object.freeze({
    storeDir,
    packsDir,
    registryFile,
    cacheDir,
    packsCacheDir,
  });
}

/**
 * Creates a directory if it doesn't exist.
 *
 * This operation is idempotent - calling it multiple times with the same
 * path is safe and has no additional effect after the first successful call.
 *
 * @param dirPath - Absolute path to the directory to create
 * @throws ScaffoldError with actionable message if creation fails
 * @internal
 */
function ensureDirectory(dirPath: string): void {
  try {
    // recursive: true makes this idempotent - no error if already exists
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));

    // Provide actionable error messages for common failure modes
    if (cause.message.includes("EACCES") || cause.message.includes("EPERM")) {
      throw new ScaffoldError(
        `Cannot create Store directory: permission denied`,
        "STORE_PERMISSION_DENIED",
        {
          path: dirPath,
          action: "Check directory permissions or run with appropriate privileges",
        },
        undefined,
        `Unable to create ${dirPath}. Ensure you have write permissions to the parent directory.`,
        cause,
        true,
      );
    }

    // Handle disk full, read-only filesystem, etc.
    if (cause.message.includes("ENOSPC")) {
      throw new ScaffoldError(
        `Cannot create Store directory: disk full`,
        "STORE_DISK_FULL",
        { path: dirPath },
        undefined,
        `Unable to create ${dirPath}. The disk appears to be full.`,
        cause,
        true,
      );
    }

    if (cause.message.includes("EROFS")) {
      throw new ScaffoldError(
        `Cannot create Store directory: read-only filesystem`,
        "STORE_READONLY_FS",
        { path: dirPath },
        undefined,
        `Unable to create ${dirPath}. The filesystem is read-only.`,
        cause,
        true,
      );
    }

    // Generic fallback for unexpected errors
    throw new ScaffoldError(
      `Failed to create Store directory`,
      "STORE_CREATE_FAILED",
      { path: dirPath, reason: cause.message },
      undefined,
      `Could not create ${dirPath}. ${cause.message}`,
      cause,
      true,
    );
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initializes the Scaffoldix Store and returns resolved paths.
 *
 * This is the PRIMARY entry point for Store path resolution. Call this once
 * during CLI initialization to:
 * 1. Resolve platform-appropriate Store paths
 * 2. Ensure required directories exist on disk
 * 3. Cache paths for subsequent access
 *
 * ## Lifecycle Guarantees
 *
 * - **Explicit**: Initialization only happens when you call this function,
 *   never implicitly on import.
 * - **Idempotent**: Safe to call multiple times. Subsequent calls return
 *   cached paths and re-verify directories exist.
 * - **Atomic**: Either all directories are created successfully, or an
 *   error is thrown (no partial state).
 *
 * ## Usage
 *
 * ```typescript
 * import { initStorePaths } from "./core/utils/paths.js";
 *
 * // During CLI startup (e.g., in main.ts)
 * const storePaths = initStorePaths();
 *
 * // Pass paths to services that need them
 * const registry = new RegistryService(storePaths.registryFile);
 * const store = new StoreService(storePaths.packsDir);
 * ```
 *
 * @param options - Initialization options
 * @returns Resolved Store paths (frozen, immutable)
 * @throws ScaffoldError if directory creation fails
 */
export function initStorePaths(options: InitStoreOptions = {}): StorePaths {
  const { ensureDirectories = true } = options;

  // Resolve paths (uses cache if available)
  const paths = cachedPaths ?? resolveStorePaths();

  if (ensureDirectories) {
    // Create directories in dependency order:
    // 1. storeDir must exist before children can be created
    // 2. registryFile is NOT created here (RegistryService's responsibility)
    // 3. cacheDir must exist before packsCacheDir
    ensureDirectory(paths.storeDir);
    ensureDirectory(paths.packsDir);
    ensureDirectory(paths.cacheDir);
    ensureDirectory(paths.packsCacheDir);
  }

  // Cache for subsequent calls
  cachedPaths = paths;

  return paths;
}

/**
 * Gets resolved Store paths WITHOUT creating directories.
 *
 * Use this for read-only operations where you need path information but
 * don't want to modify the filesystem. Examples:
 * - Checking if the Store exists
 * - Displaying Store location to users
 * - Unit tests that mock the filesystem
 *
 * ## Note on Caching
 *
 * If `initStorePaths()` was previously called, this returns the cached paths.
 * Otherwise, it resolves paths fresh (but does not cache them, allowing
 * tests to run with different configurations).
 *
 * @returns Resolved Store paths (frozen, immutable)
 *
 * @example
 * ```typescript
 * import { getStorePaths } from "./core/utils/paths.js";
 *
 * const paths = getStorePaths();
 * console.log(`Store location: ${paths.storeDir}`);
 *
 * if (fs.existsSync(paths.registryFile)) {
 *   console.log("Registry exists");
 * }
 * ```
 */
export function getStorePaths(): StorePaths {
  return cachedPaths ?? resolveStorePaths();
}

/**
 * Checks if the Store has been initialized on disk.
 *
 * This checks for the existence of the Store directory structure,
 * not just whether `initStorePaths()` was called.
 *
 * @returns true if Store directories exist, false otherwise
 *
 * @example
 * ```typescript
 * if (!isStoreInitialized()) {
 *   console.log("Initializing Store for first time...");
 *   initStorePaths();
 * }
 * ```
 */
export function isStoreInitialized(): boolean {
  const paths = getStorePaths();
  return fs.existsSync(paths.storeDir) && fs.existsSync(paths.packsDir);
}

// =============================================================================
// Testing Utilities
// =============================================================================

/**
 * Clears the cached Store paths.
 *
 * This is intended for testing purposes only. It allows tests to:
 * - Run with fresh path resolution
 * - Test initialization behavior
 * - Avoid state leakage between tests
 *
 * @internal
 */
export function _resetStorePathsCache(): void {
  cachedPaths = null;
}
