/**
 * Npm Pack Fetcher.
 *
 * Handles downloading and extracting packs from the npm registry.
 * Supports any valid npm package specifier:
 *   - @scope/package-name
 *   - package-name@1.2.3
 *   - package-name@latest
 *
 * Usage shorthand in CLI:
 *   scaffoldix pack add npm:@myorg/scaffoldix-java-spring
 *   scaffoldix pack add npm:my-pack@2.0.0
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execa } from "execa";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface NpmFetchOptions {
  /** npm registry URL override */
  readonly registry?: string;
}

export interface NpmFetchResult {
  /** Absolute path to the extracted pack directory */
  readonly packDir: string;
  /** The npm package specifier that was fetched */
  readonly packageSpec: string;
  /** Resolved package name from package.json */
  readonly packageName: string;
  /** Resolved package version from package.json */
  readonly packageVersion: string;
}

// =============================================================================
// NpmPackFetcher
// =============================================================================

/**
 * Fetches Scaffoldix packs from the npm registry.
 *
 * Uses `npm pack --dry-run` to resolve, then `npm pack` to download the tarball,
 * and `tar` to extract it to a temporary directory.
 */
export class NpmPackFetcher {
  private readonly storeDir: string;
  private readonly tempBaseDir: string;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.tempBaseDir = path.join(storeDir, ".tmp", "npm-packs");
  }

  /**
   * Detects if a string is an npm pack reference.
   * Matches: npm:<spec>
   */
  static isNpmRef(input: string): boolean {
    return /^npm:/i.test(input);
  }

  /**
   * Strips the npm: prefix from a reference.
   */
  static parseSpec(input: string): string {
    return input.replace(/^npm:/i, "");
  }

  /**
   * Downloads and extracts an npm package.
   *
   * @param npmRef - npm reference (e.g. "npm:@scope/pack" or "@scope/pack@1.0.0")
   * @param options - Fetch options
   * @returns Result with extracted pack directory
   */
  async fetch(npmRef: string, options: NpmFetchOptions = {}): Promise<NpmFetchResult> {
    const spec = NpmPackFetcher.isNpmRef(npmRef) ? NpmPackFetcher.parseSpec(npmRef) : npmRef;
    const tempDir = await this.createTempDir();

    try {
      // Run `npm pack <spec> --pack-destination <tempDir>`
      const npmArgs = ["pack", spec, "--pack-destination", tempDir];
      if (options.registry) {
        npmArgs.push("--registry", options.registry);
      }

      let packOutput: string;
      try {
        const result = await execa("npm", npmArgs, {
          cwd: tempDir,
          timeout: 60_000,
        });
        packOutput = result.stdout.trim();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ScaffoldError(
          `Failed to download npm package: ${spec}`,
          "NPM_PACK_FAILED",
          { spec },
          undefined,
          `Could not download "${spec}" from npm registry. ` +
            `Verify the package exists and is accessible. Error: ${message}`,
          err instanceof Error ? err : undefined,
          true,
        );
      }

      // npm pack outputs the tarball filename on the last line
      const tarballName = packOutput.split("\n").pop()?.trim();
      if (!tarballName) {
        throw new ScaffoldError(
          `npm pack produced no tarball for: ${spec}`,
          "NPM_PACK_NO_TARBALL",
          { spec },
          undefined,
          `npm pack did not produce a tarball. Check the package specifier.`,
          undefined,
          true,
        );
      }

      const tarballPath = path.join(tempDir, tarballName);
      const extractDir = path.join(tempDir, "package");
      await fs.mkdir(extractDir, { recursive: true });

      // Extract tarball — npm tarballs always extract to a "package/" subfolder
      try {
        await execa("tar", ["xzf", tarballPath, "-C", tempDir], { timeout: 30_000 });
      } catch (err) {
        throw new ScaffoldError(
          `Failed to extract npm tarball: ${tarballName}`,
          "NPM_EXTRACT_FAILED",
          { spec, tarballPath },
          undefined,
          `Could not extract ${tarballName}. The download may be corrupt.`,
          err instanceof Error ? err : undefined,
          true,
        );
      }

      // Read package.json to get resolved name/version
      const pkgJsonPath = path.join(extractDir, "package.json");
      let pkgName = spec;
      let pkgVersion = "unknown";
      try {
        const pkgRaw = await fs.readFile(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string };
        pkgName = pkg.name ?? spec;
        pkgVersion = pkg.version ?? "unknown";
      } catch {
        // Proceed with defaults
      }

      return {
        packDir: extractDir,
        packageSpec: spec,
        packageName: pkgName,
        packageVersion: pkgVersion,
      };
    } catch (error) {
      await this.removeTempDir(tempDir);
      throw error;
    }
  }

  /**
   * Cleans up the temporary directory after the pack has been installed.
   */
  async cleanup(result: NpmFetchResult): Promise<void> {
    // Remove the parent temp dir (which includes both the tarball and extracted dir)
    const parentDir = path.dirname(result.packDir);
    await this.removeTempDir(parentDir);
  }

  private async createTempDir(): Promise<string> {
    await fs.mkdir(this.tempBaseDir, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const dir = path.join(this.tempBaseDir, id);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private async removeTempDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
