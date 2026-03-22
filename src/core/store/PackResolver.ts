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
// Semver Range Matching
// =============================================================================

/**
 * Checks if a version satisfies a semver range string.
 *
 * Supported range operators:
 *   ^1.2.3  — compatible (same major, >= minor/patch)
 *   ~1.2.3  — approximately (same major.minor, >= patch)
 *   >=1.2.3 — greater than or equal
 *   >1.2.3  — strictly greater
 *   <=1.2.3 — less than or equal
 *   <1.2.3  — strictly less
 *   1.2.3   — exact match (same as =1.2.3)
 *   *       — any version
 *   latest  — alias for *
 */
export function satisfiesSemverRange(version: string, range: string): boolean {
  const trimmed = range.trim();

  if (trimmed === "*" || trimmed === "latest" || trimmed === "") return true;

  // ^major.minor.patch — compatible with: same major, >= minor.patch
  const caretMatch = trimmed.match(/^\^(\d+\.\d+\.\d+.*)$/);
  if (caretMatch) {
    const base = parseSemver(caretMatch[1]);
    const v = parseSemver(version);
    if (base.major !== v.major) return false;
    return compareSemver(version, caretMatch[1]) >= 0;
  }

  // ~major.minor.patch — same major.minor, >= patch
  const tildeMatch = trimmed.match(/^~(\d+\.\d+\.\d+.*)$/);
  if (tildeMatch) {
    const base = parseSemver(tildeMatch[1]);
    const v = parseSemver(version);
    if (base.major !== v.major || base.minor !== v.minor) return false;
    return compareSemver(version, tildeMatch[1]) >= 0;
  }

  // >=, >, <=, < operators
  const opMatch = trimmed.match(/^(>=|>|<=|<)(.+)$/);
  if (opMatch) {
    const [, op, ver] = opMatch;
    const cmp = compareSemver(version, ver.trim());
    if (op === ">=") return cmp >= 0;
    if (op === ">") return cmp > 0;
    if (op === "<=") return cmp <= 0;
    if (op === "<") return cmp < 0;
  }

  // Exact match (possibly with = prefix)
  const exactVer = trimmed.replace(/^=/, "");
  return compareSemver(version, exactVer) === 0;
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
   * Resolves a pack to the best matching version for a semver range.
   *
   * Supports ranges like: ^1.0.0, ~1.2.3, >=2.0.0, latest, *
   *
   * @param packId - Pack identifier
   * @param range - Semver range string
   * @returns Resolved pack matching the range (highest satisfying version)
   * @throws ScaffoldError if no installed version satisfies the range
   */
  async resolveRange(packId: string, range: string): Promise<ResolvedPack> {
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

    const installs = await this.registryService.getPackInstalls(packId);
    if (!installs || installs.length === 0) {
      return {
        packId,
        version: entry.version,
        origin: entry.origin,
        hash: entry.hash,
        installedAt: entry.installedAt,
      };
    }

    // Find all versions satisfying the range
    const matching = installs
      .filter((i) => satisfiesSemverRange(i.version, range))
      .sort((a, b) => compareSemver(b.version, a.version)); // highest first

    if (matching.length === 0) {
      const available = installs.map((i) => i.version).sort((a, b) => compareSemver(b, a));
      throw new ScaffoldError(
        `No installed version of '${packId}' satisfies range '${range}'`,
        "VERSION_RANGE_NOT_SATISFIED",
        { packId, range, availableVersions: available },
        undefined,
        `No installed version satisfies "${range}". ` +
          `Available versions: ${available.join(", ")}. ` +
          `Install a compatible version with \`scaffoldix pack add <source>\`.`,
        undefined,
        true,
      );
    }

    const best = matching[0];
    return {
      packId,
      version: best.version,
      origin: best.origin,
      hash: best.hash,
      installedAt: best.installedAt,
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
