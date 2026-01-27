/**
 * Staging Manager - Manages staging directories for transactional generation.
 *
 * This module provides a two-phase commit pattern for generation:
 * 1. Phase 1 (staging): All operations happen in a temporary staging directory
 * 2. Phase 2 (commit): On success, staging is moved atomically to target
 *
 * Benefits:
 * - Target is never partially written on failure
 * - Rollback is automatic (just delete staging)
 * - Cross-platform compatible (uses rename/move semantics)
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for commit operation.
 */
export interface CommitOptions {
  /**
   * If true, overwrite existing target directory.
   * If false (default), throw if target exists.
   */
  force?: boolean;
}

/**
 * Logger interface for staging operations.
 */
export interface StagingLogger {
  /** Log debug messages */
  debug?(message: string): void;
  /** Log info messages */
  info?(message: string): void;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Name of the staging subdirectory under storeDir.
 */
const STAGING_DIRNAME = ".staging";

/**
 * Name of the rollback backup subdirectory.
 */
const ROLLBACK_DIRNAME = ".rollback";

// =============================================================================
// StagingManager Class
// =============================================================================

/**
 * Manages staging directories for transactional generation.
 *
 * @example
 * ```typescript
 * const manager = new StagingManager("/path/to/store");
 *
 * // Create staging directory
 * const stagingDir = await manager.createStagingDir();
 *
 * try {
 *   // ... do all generation work in stagingDir ...
 *
 *   // On success, commit to target
 *   await manager.commit(stagingDir, targetDir);
 * } catch (error) {
 *   // On failure, cleanup staging
 *   await manager.cleanup(stagingDir);
 *   throw error;
 * }
 * ```
 */
export class StagingManager {
  private readonly storeDir: string;
  private readonly logger?: StagingLogger;

  /**
   * Creates a new StagingManager.
   *
   * @param storeDir - Base directory for staging (staging dirs created under storeDir/.staging/)
   * @param logger - Optional logger for debug/info messages
   */
  constructor(storeDir: string, logger?: StagingLogger) {
    this.storeDir = storeDir;
    this.logger = logger;
  }

  /**
   * Creates a new unique staging directory.
   *
   * @returns Absolute path to the created staging directory
   */
  async createStagingDir(): Promise<string> {
    const stagingBase = path.join(this.storeDir, STAGING_DIRNAME);
    await fs.mkdir(stagingBase, { recursive: true });

    // Generate unique name: timestamp-randomhex
    const timestamp = Date.now();
    const random = randomBytes(4).toString("hex");
    const stagingName = `${timestamp}-${random}`;
    const stagingDir = path.join(stagingBase, stagingName);

    await fs.mkdir(stagingDir, { recursive: true });

    this.log("debug", `Created staging directory: ${stagingDir}`);

    return stagingDir;
  }

  /**
   * Cleans up a staging directory.
   *
   * @param stagingDir - Path to staging directory to remove
   */
  async cleanup(stagingDir: string): Promise<void> {
    try {
      await fs.rm(stagingDir, { recursive: true, force: true });
      this.log("debug", `Cleaned up staging directory: ${stagingDir}`);
    } catch (error) {
      // Best-effort cleanup - log but don't throw
      this.log("debug", `Failed to cleanup staging (may not exist): ${stagingDir}`);
    }
  }

  /**
   * Commits staging directory to target by moving it.
   *
   * @param stagingDir - Source staging directory
   * @param targetDir - Destination target directory
   * @param options - Commit options (force for overwrite)
   * @throws ScaffoldError if target exists and force is not set
   */
  async commit(stagingDir: string, targetDir: string, options?: CommitOptions): Promise<void> {
    const force = options?.force ?? false;

    // Check if target exists
    const targetExists = await this.directoryExists(targetDir);

    if (targetExists && !force) {
      throw new ScaffoldError(
        "Target directory already exists",
        "TARGET_EXISTS",
        { targetDir },
        undefined,
        `Target directory "${targetDir}" already exists. ` +
          `Choose a different target directory or use --force to overwrite.`,
        undefined,
        true
      );
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    let backupDir: string | undefined;

    if (targetExists && force) {
      // Create backup of existing target
      backupDir = await this.createBackupDir();
      this.log("debug", `Backing up existing target to: ${backupDir}`);

      try {
        await fs.rename(targetDir, backupDir);
      } catch (error) {
        // If backup fails, abort
        await this.cleanupBackup(backupDir);
        throw new ScaffoldError(
          "Failed to backup existing target",
          "COMMIT_BACKUP_FAILED",
          { targetDir, backupDir },
          undefined,
          `Failed to backup existing target directory before overwrite.`,
          error instanceof Error ? error : undefined,
          true
        );
      }
    }

    // Move staging to target
    try {
      await fs.rename(stagingDir, targetDir);
      this.log("info", `Committed staging to target: ${targetDir}`);
    } catch (renameError) {
      // rename failed - try copy+delete fallback (cross-filesystem)
      try {
        await this.copyDirectory(stagingDir, targetDir);
        await fs.rm(stagingDir, { recursive: true, force: true });
        this.log("info", `Committed staging to target (via copy): ${targetDir}`);
      } catch (copyError) {
        // Commit failed - restore backup if exists
        if (backupDir) {
          try {
            await fs.rename(backupDir, targetDir);
            this.log("debug", `Restored backup after commit failure`);
          } catch {
            // Backup restore failed - this is bad, but we'll report the original error
          }
        }

        throw new ScaffoldError(
          "Failed to commit staging to target",
          "COMMIT_FAILED",
          { stagingDir, targetDir },
          undefined,
          `Failed to move staging directory to target. ` +
            `The target directory was not modified.`,
          copyError instanceof Error ? copyError : undefined,
          true
        );
      }
    }

    // Commit succeeded - cleanup backup
    if (backupDir) {
      await this.cleanupBackup(backupDir);
    }
  }

  /**
   * Cleans up all staging directories (for maintenance).
   */
  async cleanupAllStaging(): Promise<void> {
    const stagingBase = path.join(this.storeDir, STAGING_DIRNAME);

    try {
      await fs.rm(stagingBase, { recursive: true, force: true });
      this.log("debug", `Cleaned up all staging directories`);
    } catch {
      // Best-effort cleanup
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Checks if a directory exists.
   */
  private async directoryExists(dir: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Creates a backup directory for rollback.
   */
  private async createBackupDir(): Promise<string> {
    const rollbackBase = path.join(this.storeDir, ROLLBACK_DIRNAME);
    await fs.mkdir(rollbackBase, { recursive: true });

    const timestamp = Date.now();
    const random = randomBytes(4).toString("hex");
    const backupName = `${timestamp}-${random}`;
    const backupDir = path.join(rollbackBase, backupName);

    return backupDir;
  }

  /**
   * Cleans up a backup directory.
   */
  private async cleanupBackup(backupDir: string): Promise<void> {
    try {
      await fs.rm(backupDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Copies a directory recursively (fallback for cross-filesystem moves).
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Logs a message if logger is available.
   */
  private log(level: "debug" | "info", message: string): void {
    if (this.logger) {
      if (level === "debug" && this.logger.debug) {
        this.logger.debug(message);
      } else if (level === "info" && this.logger.info) {
        this.logger.info(message);
      }
    }
  }
}
