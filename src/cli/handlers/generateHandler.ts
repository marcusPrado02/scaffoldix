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
import { ScaffoldError } from "../../core/errors/errors.js";
import { RegistryService } from "../../core/registry/RegistryService.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import {
  renderArchetype,
  type FileEntry,
  type RenameRules,
} from "../../core/render/Renderer.js";
import { ProjectStateManager } from "../../core/state/ProjectStateManager.js";

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
}

/**
 * Dependencies for the generate handler.
 */
export interface GenerateDependencies {
  /** Absolute path to the registry file */
  readonly registryFile: string;

  /** Absolute path to the packs directory */
  readonly packsDir: string;
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
 * ## Process
 *
 * 1. Parse archetype reference
 * 2. Load registry and find pack
 * 3. Validate pack store path exists
 * 4. Load manifest and find archetype
 * 5. Validate template directory exists
 * 6. Render templates to target directory
 *
 * ## Error Handling
 *
 * - Pack not found: Actionable error with pack list suggestion
 * - Archetype not found: Actionable error with pack info suggestion
 * - Store path missing: Actionable error suggesting reinstall
 * - Template dir missing: Actionable error pointing to templateRoot
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
  const { ref, targetDir, dryRun, data, renameRules } = input;
  const { registryFile, packsDir } = deps;

  // 1. Parse archetype reference
  const { packId, archetypeId } = parseArchetypeRef(ref);

  // 2. Load registry and find pack
  const registryService = new RegistryService(registryFile);
  const packEntry = await registryService.getPack(packId);

  if (!packEntry) {
    throw new ScaffoldError(
      `Pack '${packId}' not found`,
      "PACK_NOT_FOUND",
      { packId },
      undefined,
      `Pack '${packId}' is not installed. Run \`scaffoldix pack list\` to see installed packs.`,
      undefined,
      true
    );
  }

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

  // 6. Render templates to target directory
  const renderResult = await renderArchetype({
    templateDir,
    targetDir,
    data,
    renameRules,
    dryRun,
  });

  // 7. Write project state (non-dry-run only)
  // State is NOT written on dry-run to avoid misleading state
  if (!dryRun) {
    const stateManager = new ProjectStateManager();
    await stateManager.write(targetDir, {
      packId,
      packVersion: packEntry.version,
      archetypeId,
      inputs: data,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    packId,
    archetypeId,
    targetDir,
    dryRun,
    filesWritten: renderResult.filesWritten,
    filesPlanned: renderResult.filesPlanned,
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

  return lines;
}
