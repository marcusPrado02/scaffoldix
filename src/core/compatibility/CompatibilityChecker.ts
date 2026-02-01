/**
 * Compatibility Checker Module.
 *
 * Validates whether the current Scaffoldix CLI version is compatible
 * with a pack's declared compatibility constraints.
 *
 * ## Compatibility Rules
 *
 * - If no compatibility section exists, assume compatible (backward compat)
 * - minVersion: CLI version must be >= minVersion
 * - maxVersion: CLI version must be <= maxVersion
 * - incompatible: CLI version must not match any listed version
 *
 * @module
 */

import type { CompatibilityConfig } from "../manifest/ManifestLoader.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a compatibility check.
 */
export interface CompatibilityResult {
  /** Whether the version is compatible */
  readonly compatible: boolean;

  /** Human-readable reason if incompatible */
  readonly reason?: string;
}

// =============================================================================
// Semver Utilities
// =============================================================================

/**
 * Parsed semver components.
 */
interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
}

/**
 * Parses a semver string into numeric parts for comparison.
 * Handles standard semver (major.minor.patch) and prerelease tags.
 *
 * Prerelease versions are considered lower than their release counterparts.
 */
function parseSemver(version: string): ParsedSemver {
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
 * Compares two semver strings.
 * Returns negative if a < b, positive if a > b, 0 if equal.
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

/**
 * Returns true if version a >= version b (semver comparison).
 */
function gte(a: string, b: string): boolean {
  return compareSemver(a, b) >= 0;
}

/**
 * Returns true if version a <= version b (semver comparison).
 */
function lte(a: string, b: string): boolean {
  return compareSemver(a, b) <= 0;
}

// =============================================================================
// CompatibilityChecker
// =============================================================================

/**
 * Static utility class for checking version compatibility.
 *
 * ## Usage
 *
 * ```typescript
 * const result = CompatibilityChecker.check("0.1.0", {
 *   minVersion: "0.2.0",
 *   maxVersion: "2.5.0",
 *   incompatible: ["0.3.4"]
 * });
 *
 * if (!result.compatible) {
 *   console.error("Incompatible:", result.reason);
 * }
 * ```
 */
export class CompatibilityChecker {
  /**
   * Checks if the given CLI version is compatible with the constraints.
   *
   * @param cliVersion - Current Scaffoldix CLI version
   * @param compatibility - Compatibility constraints from manifest (optional)
   * @returns Compatibility result with reason if incompatible
   */
  static check(
    cliVersion: string,
    compatibility: CompatibilityConfig | undefined,
  ): CompatibilityResult {
    // No constraints = compatible (backward compat)
    if (!compatibility) {
      return { compatible: true };
    }

    const { minVersion, maxVersion, incompatible } = compatibility;

    // Check minVersion constraint
    if (minVersion && !gte(cliVersion, minVersion)) {
      return {
        compatible: false,
        reason: `Requires minimum Scaffoldix version ${minVersion}`,
      };
    }

    // Check maxVersion constraint
    if (maxVersion && !lte(cliVersion, maxVersion)) {
      return {
        compatible: false,
        reason: `Requires maximum Scaffoldix version ${maxVersion}`,
      };
    }

    // Check incompatible list
    if (incompatible && incompatible.includes(cliVersion)) {
      return {
        compatible: false,
        reason: `Scaffoldix version ${cliVersion} is explicitly marked as incompatible`,
      };
    }

    return { compatible: true };
  }

  /**
   * Formats compatibility constraints for display.
   *
   * @param compatibility - Compatibility constraints from manifest
   * @returns Formatted string describing constraints
   */
  static formatConstraints(compatibility: CompatibilityConfig | undefined): string {
    if (!compatibility) {
      return "";
    }

    const parts: string[] = [];
    const { minVersion, maxVersion, incompatible } = compatibility;

    if (minVersion && maxVersion) {
      parts.push(`>=${minVersion} <=${maxVersion}`);
    } else if (minVersion) {
      parts.push(`>=${minVersion}`);
    } else if (maxVersion) {
      parts.push(`<=${maxVersion}`);
    }

    if (incompatible && incompatible.length > 0) {
      parts.push(`excludes [${incompatible.join(", ")}]`);
    }

    return parts.join("; ");
  }
}
