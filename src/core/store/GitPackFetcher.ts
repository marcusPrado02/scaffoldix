/**
 * Git Pack Fetcher.
 *
 * Handles cloning git repositories to fetch packs for installation.
 * Supports branches, tags, and commit hashes as refs.
 *
 * ## Usage
 *
 * ```typescript
 * const fetcher = new GitPackFetcher(storeDir);
 *
 * // Clone a repository
 * const result = await fetcher.fetch("https://github.com/user/pack.git");
 *
 * // Clone with a specific ref
 * const result = await fetcher.fetch(url, { ref: "v1.0.0" });
 *
 * // Process the pack...
 *
 * // Clean up when done
 * await fetcher.cleanup(result);
 * ```
 *
 * ## Temp Directory Strategy
 *
 * Clones are made to temporary directories under:
 * `<storeDir>/.tmp/git-clones/<timestamp>-<random>/`
 *
 * This ensures:
 * - Clones are isolated from each other
 * - Easy cleanup on failure
 * - No conflicts with the store structure
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import simpleGit, { type SimpleGit, GitError } from "simple-git";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for fetching a git repository.
 */
export interface GitFetchOptions {
  /** Branch, tag, or commit hash to checkout. Defaults to repo default branch. */
  readonly ref?: string;
}

/**
 * Result of a successful git fetch operation.
 */
export interface GitFetchResult {
  /** Path to the cloned pack directory. */
  readonly packDir: string;

  /** The git URL or path that was cloned. */
  readonly url: string;

  /** The resolved commit hash (HEAD after checkout). */
  readonly commit: string;

  /** The ref that was checked out (if provided). */
  readonly ref?: string;
}

// =============================================================================
// URL Detection Patterns
// =============================================================================

/**
 * Patterns to detect git URLs.
 *
 * Matches:
 * - https://... (GitHub, GitLab, etc.)
 * - http://... (insecure git servers)
 * - git@host:path (SSH shorthand)
 * - ssh://... (explicit SSH URLs)
 */
const GIT_URL_PATTERNS = [
  /^https?:\/\//i, // HTTP(S) URLs
  /^git@[^:]+:/i, // SSH shorthand (git@host:path)
  /^ssh:\/\//i, // Explicit SSH URLs
];

// =============================================================================
// GitPackFetcher
// =============================================================================

/**
 * Fetches packs from git repositories.
 *
 * ## Error Handling
 *
 * All errors are wrapped in ScaffoldError with actionable hints:
 * - GIT_CLONE_FAILED: Clone operation failed (network, auth, bad URL)
 * - GIT_CHECKOUT_FAILED: Checkout of ref failed (invalid ref)
 *
 * ## Cleanup
 *
 * Temp directories are automatically cleaned up on failure.
 * On success, call `cleanup(result)` when done processing the pack.
 */
export class GitPackFetcher {
  private readonly storeDir: string;
  private readonly tempBaseDir: string;

  /**
   * Creates a new GitPackFetcher.
   *
   * @param storeDir - The store directory (parent of packs dir)
   */
  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.tempBaseDir = path.join(storeDir, ".tmp", "git-clones");
  }

  /**
   * Checks if a string looks like a git URL.
   *
   * @param input - The string to check
   * @returns true if the input appears to be a git URL
   */
  static isGitUrl(input: string): boolean {
    return GIT_URL_PATTERNS.some((pattern) => pattern.test(input));
  }

  /**
   * Fetches a pack from a git repository.
   *
   * @param url - Git URL or local path to clone
   * @param options - Fetch options (ref, etc.)
   * @returns Result containing pack directory and commit info
   * @throws ScaffoldError on clone or checkout failure
   */
  async fetch(url: string, options: GitFetchOptions = {}): Promise<GitFetchResult> {
    const { ref } = options;

    // Create unique temp directory
    const tempDir = await this.createTempDir();

    try {
      // Clone the repository
      await this.cloneRepo(url, tempDir, ref);

      // Checkout ref if specified
      if (ref) {
        await this.checkoutRef(tempDir, ref, url);
      }

      // Get the resolved commit hash
      const commit = await this.getHeadCommit(tempDir);

      return {
        packDir: tempDir,
        url,
        commit,
        ref,
      };
    } catch (error) {
      // Clean up on failure
      await this.removeTempDir(tempDir);
      throw error;
    }
  }

  /**
   * Cleans up a fetched pack directory.
   *
   * @param result - The fetch result to clean up
   */
  async cleanup(result: GitFetchResult): Promise<void> {
    await this.removeTempDir(result.packDir);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Creates a unique temporary directory for cloning.
   */
  private async createTempDir(): Promise<string> {
    await fs.mkdir(this.tempBaseDir, { recursive: true });

    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    const dirname = `${timestamp}-${random}`;
    const tempDir = path.join(this.tempBaseDir, dirname);

    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Removes a temporary directory.
   */
  private async removeTempDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Clones a repository to the target directory.
   */
  private async cloneRepo(url: string, targetDir: string, ref?: string): Promise<void> {
    const git = simpleGit();

    try {
      // Use shallow clone for speed when possible
      const cloneOptions: string[] = [];

      // If ref looks like a branch or tag (not a commit hash), use depth 1
      if (!ref || !this.looksLikeCommitHash(ref)) {
        cloneOptions.push("--depth", "1");
        if (ref) {
          cloneOptions.push("--branch", ref);
        }
      }

      await git.clone(url, targetDir, cloneOptions);
    } catch (error) {
      // If shallow clone with branch fails, try full clone
      if (ref && !this.looksLikeCommitHash(ref)) {
        try {
          await fs.rm(targetDir, { recursive: true, force: true });
          await fs.mkdir(targetDir, { recursive: true });
          await git.clone(url, targetDir);
        } catch (retryError) {
          throw this.wrapCloneError(url, retryError);
        }
      } else {
        throw this.wrapCloneError(url, error);
      }
    }
  }

  /**
   * Checks out a specific ref in the cloned repository.
   */
  private async checkoutRef(repoDir: string, ref: string, url: string): Promise<void> {
    const git = simpleGit(repoDir);

    try {
      // For commit hashes, we need full history for checkout
      if (this.looksLikeCommitHash(ref)) {
        // Unshallow if needed
        try {
          await git.fetch(["--unshallow"]);
        } catch {
          // Ignore if already unshallowed or not shallow
        }
      }

      await git.checkout(ref);
    } catch (error) {
      throw new ScaffoldError(
        `Failed to checkout ref '${ref}'`,
        "GIT_CHECKOUT_FAILED",
        { url, ref },
        undefined,
        `Could not checkout ref '${ref}' from ${url}. ` +
          `Verify the branch, tag, or commit hash exists. ` +
          `Check available refs with: git ls-remote ${url}`,
        error instanceof Error ? error : undefined,
        true
      );
    }
  }

  /**
   * Gets the HEAD commit hash of a repository.
   */
  private async getHeadCommit(repoDir: string): Promise<string> {
    const git = simpleGit(repoDir);
    const result = await git.revparse(["HEAD"]);
    return result.trim();
  }

  /**
   * Checks if a string looks like a git commit hash.
   */
  private looksLikeCommitHash(ref: string): boolean {
    // Full SHA-1 hash (40 chars) or abbreviated (7+ chars)
    return /^[a-f0-9]{7,40}$/i.test(ref);
  }

  /**
   * Wraps a git clone error in a ScaffoldError.
   */
  private wrapCloneError(url: string, error: unknown): ScaffoldError {
    const cause = error instanceof Error ? error : new Error(String(error));

    // Extract useful info from git error
    let details = cause.message;
    if (error instanceof GitError) {
      details = error.message;
    }

    return new ScaffoldError(
      `Failed to clone git repository`,
      "GIT_CLONE_FAILED",
      { url, details },
      undefined,
      `Could not clone repository from ${url}. ` +
        `Check network connectivity, authentication, and that the repository URL is correct. ` +
        `Error: ${details}`,
      cause,
      true
    );
  }
}
