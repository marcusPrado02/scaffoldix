/**
 * Pack Resolver for Scaffoldix CLI.
 *
 * Handles version selection when looking up installed packs:
 * - No version specified: returns the latest installed version (highest semver)
 * - Version specified: returns the matching version or throws with available list
 *
 * Works with both single-version (legacy) and multi-version pack entries.
 *
 * @module
 */

import { ScaffoldError } from "../errors/errors.js";
import {
  RegistryService,
  type PackInstallRecord,
  type PackOrigin,
} from "../registry/RegistryService.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of resolving a pack version.
 */
export interface ResolvedPack {
  /** Pack identifier */
  readonly packId: string;

  /** Resolved version */
  readonly version: string;

  /** Pack origin (where it was installed from) */
  readonly origin: PackOrigin;

  /** SHA-256 manifest hash */
  readonly hash: string;

  /** Installation timestamp */
  readonly installedAt: string;
}

// =============================================================================
// Semver Comparison
// =============================================================================

/**
 * Parses a semver string into numeric parts for comparison.
 * Handles standard semver (major.minor.patch) and prerelease tags.
 *
 * Prerelease versions are considered lower than their release counterparts.
 */
function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
} {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    // Non-standard version: treat as 0.0.0 with the string as prerelease
    return { major: 0, minor: 0, patch: 0, prerelease: version };
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Compares two semver strings. Returns negative if a < b, positive if a > b, 0 if equal.
 *
 * Prerelease versions sort lower than their release counterpart:
 *   2.0.0-beta.1 < 2.0.0
 *   1.0.0 < 2.0.0-beta.1 (different major)
 */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);

  // Compare major.minor.patch
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // Both have same major.minor.patch
  // No prerelease > has prerelease (1.0.0 > 1.0.0-beta)
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && !pb.prerelease) return -1;

  // Both have prerelease: compare lexically
  if (pa.prerelease && pb.prerelease) {
    return pa.prerelease.localeCompare(pb.prerelease);
  }

  return 0;
}

// =============================================================================
// PackResolver Class
// =============================================================================

/**
 * Resolves pack versions from the registry.
 *
 * @example
 * ```typescript
 * const resolver = new PackResolver(registryFile);
 *
 * // Resolve latest version
 * const pack = await resolver.resolve("my-pack");
 *
 * // Resolve specific version
 * const v1 = await resolver.resolve("my-pack", "1.0.0");
 *
 * // List available versions
 * const versions = await resolver.listVersions("my-pack");
 * ```
 */
export class PackResolver {
  private readonly registryService: RegistryService;

  constructor(registryFile: string) {
    this.registryService = new RegistryService(registryFile);
  }

  /**
   * Resolves a pack to a specific version.
   *
   * @param packId - Pack identifier
   * @param version - Optional version to select (default: latest)
   * @returns Resolved pack with version details
   * @throws ScaffoldError PACK_NOT_FOUND if pack doesn't exist
   * @throws ScaffoldError VERSION_NOT_FOUND if version doesn't match
   */
  async resolve(packId: string, version?: string): Promise<ResolvedPack> {
    // Load pack entry
    const entry = await this.registryService.getPack(packId);

    if (!entry) {
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

    // Get all available installs
    const installs = await this.registryService.getPackInstalls(packId);
    if (!installs || installs.length === 0) {
      // Fallback to single entry (should not happen after getPackInstalls handles it)
      return {
        packId,
        version: entry.version,
        origin: entry.origin,
        hash: entry.hash,
        installedAt: entry.installedAt,
      };
    }

    // If no version specified, return latest (highest semver)
    if (!version) {
      return this.resolveLatest(packId, installs);
    }

    // Find matching version
    const match = installs.find((i) => i.version === version);
    if (!match) {
      const available = installs.map((i) => i.version).sort((a, b) => compareSemver(b, a)); // Descending

      throw new ScaffoldError(
        `Version '${version}' of pack '${packId}' not found`,
        "VERSION_NOT_FOUND",
        { packId, requestedVersion: version, availableVersions: available },
        undefined,
        `Version '${version}' is not installed for pack '${packId}'. ` +
          `Available versions: ${available.join(", ")}. ` +
          `Install a specific version with \`scaffoldix pack add <source> --version ${version}\`.`,
        undefined,
        true,
      );
    }

    return {
      packId,
      version: match.version,
      origin: match.origin,
      hash: match.hash,
      installedAt: match.installedAt,
    };
  }

  /**
   * Lists all installed versions for a pack, sorted by semver descending.
   *
   * @param packId - Pack identifier
   * @returns Array of version strings (empty if pack not found)
   */
  async listVersions(packId: string): Promise<string[]> {
    const installs = await this.registryService.getPackInstalls(packId);

    if (!installs) {
      return [];
    }

    return installs.map((i) => i.version).sort((a, b) => compareSemver(b, a)); // Descending
  }

  /**
   * Resolves the latest version from a list of installs.
   * "Latest" means highest semver, with stable releases preferred over prereleases.
   */
  private resolveLatest(packId: string, installs: PackInstallRecord[]): ResolvedPack {
    // Sort by semver descending
    const sorted = [...installs].sort((a, b) => compareSemver(b.version, a.version));

    // Prefer stable over prerelease if available
    const stable = sorted.find((i) => !parseSemver(i.version).prerelease);
    const best = stable ?? sorted[0];

    return {
      packId,
      version: best.version,
      origin: best.origin,
      hash: best.hash,
      installedAt: best.installedAt,
    };
  }
}
