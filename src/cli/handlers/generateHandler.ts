/**
 * Handler for the `generate` CLI command.
 *
 * This module orchestrates the generation of code from an installed pack's
 * archetype templates. It connects registry lookup, manifest loading, and
 * template rendering.
 *
 * The handler is separated from the CLI wiring to enable direct testing.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScaffoldError } from "../../core/errors/errors.js";
import { PackResolver } from "../../core/store/PackResolver.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import {
  renderArchetype,
  type FileEntry,
  type RenameRules,
} from "../../core/render/Renderer.js";
import {
  ProjectStateManager,
  type GenerationReport,
  type PatchItem,
  type CommandItem,
} from "../../core/state/ProjectStateManager.js";
import { PatchEngine, type PatchApplySummary } from "../../core/patch/PatchEngine.js";
import { PatchResolver } from "../../core/patch/PatchResolver.js";
import { HookRunner, type HookRunSummary, type HookResult, type HookLogger } from "../../core/hooks/HookRunner.js";
import { CheckRunner, type CheckRunSummary, type CheckResult, type CheckLogger } from "../../core/checks/CheckRunner.js";
import { StagingManager } from "../../core/staging/StagingManager.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed archetype reference.
 */
export interface ArchetypeRef {
  readonly packId: string;
  readonly archetypeId: string;
}

/**
 * Input for the generate handler.
 */
export interface GenerateInput {
  /** Archetype reference in "packId:archetypeId" format */
  readonly ref: string;

  /** Target directory for generated files */
  readonly targetDir: string;

  /** If true, don't write files - just return what would be done */
  readonly dryRun: boolean;

  /** Data to pass to templates (collected from user or defaults) */
  readonly data: Record<string, unknown>;

  /** Optional rename rules for filename placeholders */
  readonly renameRules?: RenameRules;

  /** Optional version to select (for multi-version packs) */
  readonly version?: string;
}

/**
 * Dependencies for the generate handler.
 */
export interface GenerateDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;

  /** Absolute path to the packs directory */
  readonly packsDir: string;

  /** Absolute path to the store directory (for staging) */
  readonly storeDir: string;
}

/**
 * Individual patch result for reporting.
 */
export interface PatchReportEntry {
  /** Patch operation kind */
  readonly kind: string;

  /** Target file path */
  readonly file: string;

  /** Idempotency key */
  readonly idempotencyKey: string;

  /** Result status */
  readonly status: "applied" | "skipped" | "failed";

  /** Reason for skip or failure */
  readonly reason?: string;
}

/**
 * Patch application summary.
 */
export interface PatchReport {
  /** Total patches in manifest */
  readonly total: number;

  /** Patches successfully applied */
  readonly applied: number;

  /** Patches skipped (already applied) */
  readonly skipped: number;

  /** Patches that failed */
  readonly failed: number;

  /** Individual patch results */
  readonly entries: PatchReportEntry[];
}

/**
 * Hook execution report.
 */
export interface HookReport {
  /** Total number of hooks */
  readonly total: number;

  /** Hooks that succeeded */
  readonly succeeded: number;

  /** Hooks that failed */
  readonly failed: number;

  /** Total duration in milliseconds */
  readonly totalDurationMs: number;

  /** Whether all hooks completed successfully */
  readonly success: boolean;
}

/**
 * Check execution report.
 */
export interface CheckReport {
  /** Total number of checks */
  readonly total: number;

  /** Checks that passed */
  readonly passed: number;

  /** Checks that failed */
  readonly failed: number;

  /** Total duration in milliseconds */
  readonly totalDurationMs: number;

  /** Whether all checks passed */
  readonly success: boolean;
}

/**
 * Result of the generate operation.
 */
export interface GenerateResult {
  /** Pack identifier */
  readonly packId: string;

  /** Archetype identifier */
  readonly archetypeId: string;

  /** Target directory where files were/would be written */
  readonly targetDir: string;

  /** Whether this was a dry run */
  readonly dryRun: boolean;

  /** Files that were actually written (non-dry-run) */
  readonly filesWritten: FileEntry[];

  /** Files that would be written (dry-run) */
  readonly filesPlanned: FileEntry[];

  /** Patch application report (non-dry-run only) */
  readonly patchReport?: PatchReport;

  /** Whether patches were skipped due to dry-run */
  readonly patchesSkippedForDryRun?: boolean;

  /** Hook execution report (non-dry-run only) */
  readonly hookReport?: HookReport;

  /** Whether hooks were skipped due to dry-run */
  readonly hooksSkippedForDryRun?: boolean;

  /** Check execution report (non-dry-run only) */
  readonly checkReport?: CheckReport;

  /** Whether checks were skipped due to dry-run */
  readonly checksSkippedForDryRun?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sanitizes a pack ID for use in filesystem paths.
 * Must match the logic in StoreService.
 */
function sanitizePackId(packId: string): string {
  return packId
    .replace(/\//g, "__") // Replace / with __ (scoped packages)
    .replace(/[<>:"|?*]/g, "_"); // Replace Windows-unsafe chars
}

/**
 * Derives the store path for a pack based on its ID and hash.
 * Must match StoreService.getPackDestDir() logic.
 */
function deriveStorePath(packsDir: string, packId: string, hash: string): string {
  const sanitizedId = sanitizePackId(packId);
  return path.join(packsDir, sanitizedId, hash);
}

/**
 * Input for applying patches.
 */
interface ApplyPatchesInput {
  readonly patches: NonNullable<import("../../core/manifest/ManifestLoader.js").Archetype["patches"]>;
  readonly data: Record<string, unknown>;
  readonly packStorePath: string;
  readonly targetDir: string;
  readonly packId: string;
  readonly archetypeId: string;
}

/**
 * Creates a logger for hook execution.
 *
 * This logger outputs hook messages to the console during generation.
 *
 * @returns HookLogger implementation
 */
function createHookLogger(): HookLogger {
  return {
    info: (message: string) => console.log(`[hook] ${message}`),
    error: (message: string) => console.error(`[hook] ${message}`),
    stdout: (line: string) => console.log(`  ${line}`),
    stderr: (line: string) => console.error(`  ${line}`),
  };
}

/**
 * Creates a logger for check execution.
 *
 * This logger outputs check messages to the console during generation.
 * Includes outputBlock for displaying full command output on failure.
 *
 * @returns CheckLogger implementation
 */
function createCheckLogger(): CheckLogger {
  return {
    info: (message: string) => console.log(`[check] ${message}`),
    error: (message: string) => console.error(`[check] ${message}`),
    stdout: (line: string) => console.log(`  ${line}`),
    stderr: (line: string) => console.error(`  ${line}`),
    outputBlock: (output: string) => {
      // Print each line of the output block
      for (const line of output.split("\n")) {
        console.log(`  ${line}`);
      }
    },
  };
}

/**
 * Applies patches from manifest to target directory.
 *
 * @param input - Patches and context
 * @returns Patch application report
 */
async function applyPatches(input: ApplyPatchesInput): Promise<PatchReport> {
  const { patches, data, packStorePath, targetDir, packId, archetypeId } = input;

  // 1. Resolve patch content (template rendering)
  const resolver = new PatchResolver();
  const resolved = await resolver.resolveAll({
    patches,
    data,
    packStorePath,
  });

  // 2. Apply patches using PatchEngine
  const engine = new PatchEngine();
  let summary: PatchApplySummary;

  try {
    summary = await engine.applyAll(resolved.operations, {
      rootDir: targetDir,
      strict: true,
    });
  } catch (error) {
    // If PatchEngine throws (vs returning failed status), wrap it
    const cause = error instanceof Error ? error : new Error(String(error));
    if (error instanceof ScaffoldError) {
      throw error;
    }
    throw new ScaffoldError(
      `Unexpected error applying patches`,
      "PATCH_ENGINE_ERROR",
      { packId, archetypeId },
      undefined,
      `An unexpected error occurred while applying patches: ${cause.message}`,
      cause,
      true
    );
  }

  // 3. Convert to PatchReport format
  const entries: PatchReportEntry[] = summary.results.map((r) => ({
    kind: r.kind,
    file: r.file,
    idempotencyKey: r.idempotencyKey,
    status: r.status,
    reason: r.reason,
  }));

  return {
    total: patches.length,
    applied: summary.applied,
    skipped: summary.skipped,
    failed: summary.failed,
    entries,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parses an archetype reference string into packId and archetypeId.
 *
 * @param ref - Reference string in "packId:archetypeId" format
 * @returns Parsed reference
 * @throws ScaffoldError if format is invalid
 *
 * @example
 * parseArchetypeRef("my-pack:default")
 * // => { packId: "my-pack", archetypeId: "default" }
 *
 * parseArchetypeRef("@org/pack:component")
 * // => { packId: "@org/pack", archetypeId: "component" }
 */
export function parseArchetypeRef(ref: string): ArchetypeRef {
  // Find the last colon (to handle scoped packages like @org/pack:arch)
  const lastColonIndex = ref.lastIndexOf(":");

  if (lastColonIndex === -1) {
    throw new ScaffoldError(
      `Invalid archetype reference: "${ref}"`,
      "INVALID_ARCHETYPE_REF",
      { ref },
      undefined,
      `Expected format: packId:archetypeId (e.g., "java-spring:base-entity"). ` +
        `The colon separates pack ID from archetype ID.`,
      undefined,
      true
    );
  }

  const packId = ref.slice(0, lastColonIndex).trim();
  const archetypeId = ref.slice(lastColonIndex + 1).trim();

  if (!packId) {
    throw new ScaffoldError(
      `Invalid archetype reference: missing pack ID`,
      "INVALID_ARCHETYPE_REF",
      { ref },
      undefined,
      `Expected format: packId:archetypeId (e.g., "java-spring:base-entity"). ` +
        `Pack ID cannot be empty.`,
      undefined,
      true
    );
  }

  if (!archetypeId) {
    throw new ScaffoldError(
      `Invalid archetype reference: missing archetype ID`,
      "INVALID_ARCHETYPE_REF",
      { ref },
      undefined,
      `Expected format: packId:archetypeId (e.g., "java-spring:base-entity"). ` +
        `Archetype ID cannot be empty.`,
      undefined,
      true
    );
  }

  return { packId, archetypeId };
}

/**
 * Handles the `generate` command.
 *
 * ## Process (Transactional)
 *
 * 1. Parse archetype reference
 * 2. Load registry and find pack
 * 3. Validate pack store path exists
 * 4. Load manifest and find archetype
 * 5. Validate template directory exists
 * 6. For non-dry-run: create staging directory
 * 7. Render templates to staging (or dry-run plan)
 * 8. Apply patches in staging
 * 9. Run postGenerate hooks in staging
 * 10. Run checks in staging
 * 11. Write state.json in staging
 * 12. Commit staging to target (atomic move)
 *
 * ## Transactional Semantics
 *
 * - All operations happen in staging directory first
 * - Target is only modified on complete success (commit)
 * - On failure at any stage: staging cleaned, target untouched
 *
 * @param input - User input (ref, targetDir, dryRun, data)
 * @param deps - Injected dependencies
 * @returns Generation result with files written/planned
 * @throws ScaffoldError on validation or generation failures
 */
export async function handleGenerate(
  input: GenerateInput,
  deps: GenerateDependencies
): Promise<GenerateResult> {
  const { ref, targetDir, dryRun, data, renameRules, version } = input;
  const { registryFile, packsDir, storeDir } = deps;

  // 1. Parse archetype reference
  const { packId, archetypeId } = parseArchetypeRef(ref);

  // 2. Resolve pack version (supports multi-version selection)
  const resolver = new PackResolver(registryFile);
  const resolvedPack = await resolver.resolve(packId, version);

  // Get full entry for pack version/origin metadata
  const packEntry = {
    id: packId,
    version: resolvedPack.version,
    hash: resolvedPack.hash,
    origin: resolvedPack.origin,
    installedAt: resolvedPack.installedAt,
  };

  // 3. Validate pack store path exists
  const storePath = deriveStorePath(packsDir, packEntry.id, packEntry.hash);

  try {
    await fs.access(storePath);
  } catch {
    throw new ScaffoldError(
      `Pack is registered but missing from store`,
      "PACK_STORE_MISSING",
      {
        packId,
        storePath,
        hash: packEntry.hash,
      },
      undefined,
      `Pack '${packId}' is registered but its files are missing from the store at ${storePath}. ` +
        `Try reinstalling the pack with \`scaffoldix pack add <path>\`.`,
      undefined,
      true
    );
  }

  // 4. Load manifest and find archetype
  const manifestLoader = new ManifestLoader();
  const manifest = await manifestLoader.loadFromDir(storePath);

  const archetype = manifest.archetypes.find((a) => a.id === archetypeId);

  if (!archetype) {
    const availableArchetypes = manifest.archetypes.map((a) => a.id).join(", ");
    throw new ScaffoldError(
      `Archetype '${archetypeId}' not found in pack '${packId}'`,
      "ARCHETYPE_NOT_FOUND",
      {
        packId,
        archetypeId,
        availableArchetypes: manifest.archetypes.map((a) => a.id),
      },
      undefined,
      `Archetype '${archetypeId}' does not exist in pack '${packId}'. ` +
        `Available archetypes: ${availableArchetypes}. ` +
        `Run \`scaffoldix pack info ${packId}\` to see all archetypes.`,
      undefined,
      true
    );
  }

  // 5. Validate template directory exists
  const templateDir = path.join(storePath, archetype.templateRoot);

  try {
    const stat = await fs.stat(templateDir);
    if (!stat.isDirectory()) {
      throw new Error("Not a directory");
    }
  } catch {
    throw new ScaffoldError(
      `Template directory not found`,
      "TEMPLATE_DIR_NOT_FOUND",
      {
        packId,
        archetypeId,
        templateRoot: archetype.templateRoot,
        templateDir,
      },
      undefined,
      `The template directory '${archetype.templateRoot}' does not exist in pack '${packId}'. ` +
        `Expected at: ${templateDir}. ` +
        `The pack may be corrupted. Try reinstalling with \`scaffoldix pack add <path>\`.`,
      undefined,
      true
    );
  }

  // ===========================================================================
  // Dry-run path: no staging, just compute plan
  // ===========================================================================

  if (dryRun) {
    const renderResult = await renderArchetype({
      templateDir,
      targetDir,
      data,
      renameRules,
      dryRun: true,
    });

    const patches = archetype.patches;
    const hasPatches = patches && patches.length > 0;
    const postGenerateHooks = archetype.postGenerate;
    const hasHooks = postGenerateHooks && postGenerateHooks.length > 0;
    const checks = archetype.checks;
    const hasChecks = checks && checks.length > 0;

    return {
      packId,
      archetypeId,
      targetDir,
      dryRun: true,
      filesWritten: [],
      filesPlanned: renderResult.filesPlanned,
      patchesSkippedForDryRun: hasPatches,
      hooksSkippedForDryRun: hasHooks,
      checksSkippedForDryRun: hasChecks,
    };
  }

  // ===========================================================================
  // Real generation: use staging for transactional semantics
  // ===========================================================================

  const stagingManager = new StagingManager(storeDir, {
    info: (msg) => console.log(`[staging] ${msg}`),
    debug: (msg) => console.log(`[staging:debug] ${msg}`),
  });

  // 6. Create staging directory
  const stagingDir = await stagingManager.createStagingDir();
  console.log(`[staging] Created staging directory: ${stagingDir}`);

  // Initialize reports
  let patchReport: PatchReport | undefined;
  let hookSummary: HookRunSummary | undefined;
  let checkSummary: CheckRunSummary | undefined;
  let renderResult: { filesWritten: FileEntry[]; filesPlanned: FileEntry[] };

  try {
    // 7. Render templates to STAGING directory
    console.log(`[staging] Rendering templates...`);
    renderResult = await renderArchetype({
      templateDir,
      targetDir: stagingDir, // Render to staging, not target
      data,
      renameRules,
      dryRun: false,
    });

    // 8. Apply patches in STAGING
    const patches = archetype.patches;
    const hasPatches = patches && patches.length > 0;

    if (hasPatches) {
      console.log(`[staging] Applying patches...`);
      patchReport = await applyPatches({
        patches,
        data,
        packStorePath: storePath,
        targetDir: stagingDir, // Patches in staging
        packId,
        archetypeId,
      });

      if (patchReport.failed > 0) {
        const failedPatches = patchReport.entries.filter((e) => e.status === "failed");
        const failedSummary = failedPatches
          .map((p) => `${p.idempotencyKey}: ${p.reason}`)
          .join("; ");

        throw new ScaffoldError(
          `Patch application failed`,
          "PATCH_APPLICATION_FAILED",
          {
            packId,
            archetypeId,
            patchReport,
            failedPatches,
          },
          undefined,
          `Generation aborted: ${patchReport.failed} patch(es) failed. ` +
            `${failedSummary}. ` +
            `Target was not modified. Fix the issues and re-run.`,
          undefined,
          true
        );
      }
    }

    // 9. Run postGenerate hooks in STAGING
    const postGenerateHooks = archetype.postGenerate;
    const hasHooks = postGenerateHooks && postGenerateHooks.length > 0;

    if (hasHooks) {
      console.log(`[staging] Running postGenerate hooks...`);
      const hookRunner = new HookRunner();
      const hookLogger = createHookLogger();

      hookSummary = await hookRunner.runPostGenerate({
        commands: postGenerateHooks,
        cwd: stagingDir, // Hooks in staging
        logger: hookLogger,
      });
    }

    // 10. Run checks in STAGING
    const checks = archetype.checks;
    const hasChecks = checks && checks.length > 0;

    if (hasChecks) {
      console.log(`[staging] Running quality checks...`);
      const checkRunner = new CheckRunner();
      const checkLogger = createCheckLogger();

      checkSummary = await checkRunner.runChecks({
        commands: checks,
        cwd: stagingDir, // Checks in staging
        logger: checkLogger,
      });
    }

    // 11. Copy existing state from target to staging (for history preservation)
    // This allows recordGeneration to read existing history and append to it
    const stateManager = new ProjectStateManager();
    const existingStatePath = stateManager.getStatePath(targetDir);
    const stagingStatePath = stateManager.getStatePath(stagingDir);

    try {
      await fs.access(existingStatePath);
      // Create .scaffoldix directory in staging if needed
      await fs.mkdir(path.dirname(stagingStatePath), { recursive: true });
      await fs.copyFile(existingStatePath, stagingStatePath);
      console.log(`[staging] Preserved existing state for history...`);
    } catch {
      // No existing state - this is fine, first generation
    }

    // 12. Build generation report and write project state in STAGING
    console.log(`[staging] Writing project state...`);

    // Build GenerationReport from collected data
    const generationReport: GenerationReport = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      packId,
      packVersion: packEntry.version,
      archetypeId,
      inputs: data,
      status: "success",
    };

    // Add patches summary if patches were applied
    if (patchReport) {
      generationReport.patches = {
        total: patchReport.total,
        applied: patchReport.applied,
        skipped: patchReport.skipped,
        failed: patchReport.failed,
        items: patchReport.entries.map((e): PatchItem => ({
          kind: e.kind,
          file: e.file,
          idempotencyKey: e.idempotencyKey,
          status: e.status,
          reason: e.reason,
        })),
      };
    }

    // Add hooks summary if hooks were run
    if (hookSummary) {
      generationReport.hooks = {
        items: hookSummary.results.map((r): CommandItem => ({
          command: r.command,
          status: r.success ? "success" : "failure",
          exitCode: r.exitCode,
          durationMs: r.durationMs,
        })),
      };
    }

    // Add checks summary if checks were run
    if (checkSummary) {
      generationReport.checks = {
        items: checkSummary.results.map((r): CommandItem => ({
          command: r.command,
          status: r.success ? "success" : "failure",
          exitCode: r.exitCode,
          durationMs: r.durationMs,
        })),
      };
    }

    await stateManager.recordGeneration(stagingDir, generationReport);

    // 13. Commit staging to target (atomic move)
    // Use force: true to allow overwriting existing target (regeneration use case)
    console.log(`[staging] Committing to target: ${targetDir}`);
    await stagingManager.commit(stagingDir, targetDir, { force: true });
    console.log(`[staging] Successfully committed to target.`);

  } catch (error) {
    // Failure: cleanup staging, do NOT touch target
    console.error(`[staging] Aborted; target was not modified.`);
    await stagingManager.cleanup(stagingDir);
    throw error;
  }

  // Derive HookReport from hookSummary for CLI output
  let hookReport: HookReport | undefined;
  if (hookSummary) {
    const succeeded = hookSummary.results.filter((r) => r.success).length;
    const failed = hookSummary.results.filter((r) => !r.success).length;
    const totalDurationMs = hookSummary.results.reduce((sum, r) => sum + r.durationMs, 0);
    hookReport = {
      total: hookSummary.results.length,
      succeeded,
      failed,
      totalDurationMs,
      success: failed === 0,
    };
  }

  // Derive CheckReport from checkSummary for CLI output
  let checkReport: CheckReport | undefined;
  if (checkSummary) {
    const passed = checkSummary.results.filter((r) => r.success).length;
    const failed = checkSummary.results.filter((r) => !r.success).length;
    const totalDurationMs = checkSummary.results.reduce((sum, r) => sum + r.durationMs, 0);
    checkReport = {
      total: checkSummary.results.length,
      passed,
      failed,
      totalDurationMs,
      success: failed === 0,
    };
  }

  return {
    packId,
    archetypeId,
    targetDir,
    dryRun: false,
    filesWritten: renderResult.filesWritten,
    filesPlanned: [],
    patchReport,
    patchesSkippedForDryRun: false,
    hookReport,
    hooksSkippedForDryRun: false,
    checkReport,
    checksSkippedForDryRun: false,
  };
}

/**
 * Formats the generate result for CLI output.
 *
 * @param result - The generate result
 * @returns Array of output lines
 */
export function formatGenerateOutput(result: GenerateResult): string[] {
  const lines: string[] = [];

  if (result.dryRun) {
    lines.push("Dry run: no files were written.");
    lines.push("");
  }

  lines.push(`Generated from: ${result.packId}:${result.archetypeId}`);
  lines.push(`Target: ${result.targetDir}`);

  const files = result.dryRun ? result.filesPlanned : result.filesWritten;
  const fileCount = files.length;
  const fileWord = fileCount === 1 ? "file" : "files";
  const action = result.dryRun ? "would be created" : "created";

  lines.push(`${fileCount} ${fileWord} ${action}`);

  // List files (up to a reasonable limit)
  if (files.length > 0 && files.length <= 20) {
    lines.push("");
    for (const file of files) {
      const prefix = result.dryRun ? "  (planned) " : "  ";
      lines.push(`${prefix}${file.destRelativePath}`);
    }
  } else if (files.length > 20) {
    lines.push("");
    // Show first 10 and last 5
    for (let i = 0; i < 10; i++) {
      const prefix = result.dryRun ? "  (planned) " : "  ";
      lines.push(`${prefix}${files[i].destRelativePath}`);
    }
    lines.push(`  ... and ${files.length - 15} more`);
    for (let i = files.length - 5; i < files.length; i++) {
      const prefix = result.dryRun ? "  (planned) " : "  ";
      lines.push(`${prefix}${files[i].destRelativePath}`);
    }
  }

  // Patch report section
  if (result.patchesSkippedForDryRun) {
    lines.push("");
    lines.push("Dry run: patches were not applied.");
  } else if (result.patchReport) {
    lines.push("");
    lines.push(formatPatchReport(result.patchReport));
  }

  // Hook report section
  if (result.hooksSkippedForDryRun) {
    lines.push("");
    lines.push("Dry run: postGenerate hooks were not executed.");
  } else if (result.hookReport) {
    lines.push("");
    lines.push(formatHookReport(result.hookReport));
  }

  // Check report section
  if (result.checksSkippedForDryRun) {
    lines.push("");
    lines.push("Dry run: checks were not executed.");
  } else if (result.checkReport) {
    lines.push("");
    lines.push(formatCheckReport(result.checkReport));
  }

  return lines;
}

/**
 * Formats a patch report for CLI output.
 *
 * @param report - The patch report
 * @returns Formatted patch report string
 */
export function formatPatchReport(report: PatchReport): string {
  const lines: string[] = [];

  // Summary line
  lines.push(
    `Patches: total=${report.total} applied=${report.applied} ` +
    `skipped=${report.skipped} failed=${report.failed}`
  );

  // Individual patch results
  if (report.entries.length > 0) {
    for (const entry of report.entries) {
      const status = entry.status.toUpperCase();
      const reason = entry.reason ? ` (${entry.reason})` : "";
      lines.push(`  [${status}] ${entry.kind} ${entry.file} (${entry.idempotencyKey})${reason}`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats a hook report for CLI output.
 *
 * @param report - The hook report
 * @returns Formatted hook report string
 */
export function formatHookReport(report: HookReport): string {
  const durationStr = formatDuration(report.totalDurationMs);
  return `Hooks: total=${report.total} succeeded=${report.succeeded} ` +
    `failed=${report.failed} duration=${durationStr}`;
}

/**
 * Formats a check report for CLI output.
 *
 * @param report - The check report
 * @returns Formatted check report string
 */
export function formatCheckReport(report: CheckReport): string {
  const durationStr = formatDuration(report.totalDurationMs);
  return `Checks: total=${report.total} passed=${report.passed} ` +
    `failed=${report.failed} duration=${durationStr}`;
}

/**
 * Formats duration in human-readable format.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "1.23s" or "456ms")
 */
function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms}ms`;
}
