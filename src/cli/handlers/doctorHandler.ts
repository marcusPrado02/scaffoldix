/**
 * Handler for the `scaffoldix doctor` CLI command.
 *
 * This module provides environment diagnostics for Scaffoldix, checking:
 * - Node.js version compatibility
 * - pnpm availability
 * - Store write permissions
 * - Registry integrity
 *
 * The handler is designed to never crash - all checks are collected and
 * reported, even if individual checks fail.
 *
 * @module
 */

import { RegistryService } from "../../core/registry/RegistryService.js";
import type { StorePaths } from "../../core/utils/paths.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum required Node.js major version.
 */
export const MIN_NODE_VERSION = 18;

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a diagnostic check.
 */
export type DoctorStatus = "OK" | "WARN" | "ERROR";

/**
 * Result of a single diagnostic check.
 */
export interface DoctorCheckResult {
  /** Human-readable name of the check */
  readonly name: string;

  /** Status of the check */
  readonly status: DoctorStatus;

  /** Details about the check result */
  readonly details?: string;

  /** Actionable fix suggestion (for WARN/ERROR) */
  readonly fix?: string;
}

/**
 * Overall result of the doctor command.
 */
export interface DoctorResult {
  /** Individual check results */
  readonly checks: DoctorCheckResult[];

  /** True if any check has ERROR status */
  readonly hasErrors: boolean;
}

/**
 * Result of pnpm availability check.
 */
export interface PnpmCheckResult {
  readonly available: boolean;
  readonly version?: string;
  readonly error?: string;
}

/**
 * Dependencies for the doctor handler.
 * Using dependency injection for testability.
 */
export interface DoctorDependencies {
  /** Store paths configuration */
  readonly storePaths: StorePaths;

  /** Function to get Node.js version (default: process.versions.node) */
  readonly getNodeVersion: () => string;

  /** Function to check pnpm availability */
  readonly checkPnpm: () => Promise<PnpmCheckResult>;

  /** Function to test write access to a directory */
  readonly testWriteAccess: (dir: string) => Promise<void>;
}

// =============================================================================
// Check Implementations
// =============================================================================

/**
 * Checks if Node.js version meets minimum requirement.
 */
function checkNodeVersion(getVersion: () => string): DoctorCheckResult {
  try {
    const version = getVersion();
    const majorVersion = parseInt(version.split(".")[0], 10);

    if (majorVersion >= MIN_NODE_VERSION) {
      return {
        name: "Node.js",
        status: "OK",
        details: `v${version}`,
      };
    }

    return {
      name: "Node.js",
      status: "ERROR",
      details: `v${version} (requires >= ${MIN_NODE_VERSION})`,
      fix: `Upgrade Node.js to >= ${MIN_NODE_VERSION} (use nvm, asdf, or official installer).`,
    };
  } catch (error) {
    return {
      name: "Node.js",
      status: "ERROR",
      details: "Unable to determine version",
      fix: "Ensure Node.js is properly installed.",
    };
  }
}

/**
 * Checks if pnpm is available.
 */
async function checkPnpmAvailability(
  checkPnpm: () => Promise<PnpmCheckResult>,
): Promise<DoctorCheckResult> {
  try {
    const result = await checkPnpm();

    if (result.available) {
      return {
        name: "pnpm",
        status: "OK",
        details: result.version ?? "available",
      };
    }

    return {
      name: "pnpm",
      status: "ERROR",
      details: result.error ?? "not found",
      fix: "Install pnpm (corepack enable pnpm, or npm i -g pnpm).",
    };
  } catch (error) {
    return {
      name: "pnpm",
      status: "ERROR",
      details: "check failed",
      fix: "Install pnpm (corepack enable pnpm, or npm i -g pnpm).",
    };
  }
}

/**
 * Checks if Store directory is writable.
 */
async function checkStoreWritable(
  storeDir: string,
  testWrite: (dir: string) => Promise<void>,
): Promise<DoctorCheckResult> {
  try {
    await testWrite(storeDir);

    return {
      name: "Store writable",
      status: "OK",
      details: storeDir,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      name: "Store writable",
      status: "ERROR",
      details: `${storeDir} - ${message}`,
      fix: `Fix permissions for ${storeDir} (ensure user has write access).`,
    };
  }
}

/**
 * Checks registry integrity using RegistryService.
 */
async function checkRegistryIntegrity(registryFile: string): Promise<DoctorCheckResult> {
  try {
    const registryService = new RegistryService(registryFile);
    const registry = await registryService.load();

    const packCount = Object.keys(registry.packs).length;

    return {
      name: "Registry",
      status: "OK",
      details: `valid (${packCount} pack${packCount !== 1 ? "s" : ""})`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      name: "Registry",
      status: "ERROR",
      details: message,
      fix: `Fix or remove corrupted registry file at ${registryFile}. Reinstall packs with \`pack add\` if needed.`,
    };
  }
}

// =============================================================================
// Handler Implementation
// =============================================================================

/**
 * Runs all diagnostic checks and returns the results.
 *
 * ## Design Principles
 *
 * - **Never crashes**: All checks are wrapped in try/catch to ensure a
 *   complete report is always generated.
 * - **All checks run**: Even if one check fails, all others are executed.
 * - **Actionable output**: Every failure includes a fix suggestion.
 * - **Testable**: Dependencies are injectable for unit testing.
 *
 * @param deps - Injected dependencies for testability
 * @returns Complete diagnostic results
 */
export async function handleDoctor(deps: DoctorDependencies): Promise<DoctorResult> {
  const { storePaths, getNodeVersion, checkPnpm, testWriteAccess } = deps;

  // Run all checks, collecting results
  const checks: DoctorCheckResult[] = [];

  // 1. Node.js version check (sync)
  checks.push(checkNodeVersion(getNodeVersion));

  // 2. pnpm availability check (async)
  checks.push(await checkPnpmAvailability(checkPnpm));

  // 3. Store write permissions check (async)
  checks.push(await checkStoreWritable(storePaths.storeDir, testWriteAccess));

  // 4. Registry integrity check (async)
  checks.push(await checkRegistryIntegrity(storePaths.registryFile));

  // Determine if any errors
  const hasErrors = checks.some((check) => check.status === "ERROR");

  return {
    checks,
    hasErrors,
  };
}

/**
 * Creates default dependencies using real system checks.
 *
 * This is used by the CLI to create actual dependencies. Tests provide
 * their own mocked dependencies.
 *
 * @param storePaths - Store paths from paths module
 * @returns Dependencies configured for real system checks
 */
export function createDefaultDoctorDependencies(storePaths: StorePaths): DoctorDependencies {
  return {
    storePaths,
    getNodeVersion: () => process.versions.node,
    checkPnpm: async () => {
      try {
        // Use execFileSync instead of execSync to avoid shell injection
        // execFileSync doesn't invoke a shell, making it safer
        const { execFileSync } = await import("node:child_process");
        const result = execFileSync("pnpm", ["--version"], {
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { available: true, version: result.trim() };
      } catch {
        return { available: false, error: "not found" };
      }
    },
    testWriteAccess: async (dir: string) => {
      const { writeFile, unlink, mkdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { randomBytes } = await import("node:crypto");

      // Ensure directory exists
      await mkdir(dir, { recursive: true });

      // Write and delete test file
      const testFile = join(dir, `.doctor-test-${randomBytes(8).toString("hex")}`);
      await writeFile(testFile, "doctor-test");
      await unlink(testFile);
    },
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Formats the doctor report for CLI output.
 *
 * @param result - Doctor check results
 * @returns Array of lines to print
 */
export function formatDoctorReport(result: DoctorResult): string[] {
  const lines: string[] = [];

  // Header
  lines.push("Scaffoldix Doctor Report");
  lines.push("------------------------");

  // Each check
  for (const check of result.checks) {
    const statusTag = `[${check.status}]`.padEnd(7);
    const name = check.name;
    const details = check.details ?? "";

    lines.push(`${statusTag} ${name}: ${details}`);

    // Add fix suggestion for WARN/ERROR
    if (check.fix && (check.status === "WARN" || check.status === "ERROR")) {
      lines.push(`        Fix: ${check.fix}`);
    }
  }

  return lines;
}
