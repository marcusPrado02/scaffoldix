/**
 * Preview Planner for Scaffoldix Dry-Run Mode.
 *
 * Computes a preview of what would happen during generation without
 * writing any files to disk. Determines CREATE/MODIFY/NOOP operations
 * for each planned output file.
 *
 * ## Usage
 *
 * ```typescript
 * const planner = new PreviewPlanner();
 * const report = await planner.computePreview({
 *   templateDir: "/path/to/templates",
 *   targetDir: "/path/to/project",
 *   data: { projectName: "MyApp" },
 * });
 *
 * console.log(report.summary);
 * // { create: 3, modify: 1, noop: 0 }
 * ```
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import Handlebars from "handlebars";
import fg from "fast-glob";
import { ScaffoldError } from "../errors/errors.js";
import type { RenameRules } from "../render/Renderer.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Operation type for a file in the preview.
 */
export type FileOperation = "create" | "modify" | "noop";

/**
 * A single file in the preview report.
 */
export interface PreviewFile {
  /** Relative path in target directory */
  readonly relativePath: string;

  /** Absolute path in target directory */
  readonly absolutePath: string;

  /** Operation type: create, modify, or noop */
  readonly operation: FileOperation;

  /** Whether the file is binary (copied, not rendered) */
  readonly isBinary: boolean;

  /** Source template relative path */
  readonly sourceTemplate: string;
}

/**
 * Summary counts for preview operations.
 */
export interface PreviewSummary {
  /** Files that would be created (don't exist) */
  readonly create: number;

  /** Files that would be modified (exist and differ) */
  readonly modify: number;

  /** Files unchanged (exist and match) */
  readonly noop: number;

  /** Total files in plan */
  readonly total: number;
}

/**
 * Complete preview report.
 */
export interface PreviewReport {
  /** Target directory */
  readonly targetDir: string;

  /** Summary counts */
  readonly summary: PreviewSummary;

  /** Files that would be created */
  readonly creates: PreviewFile[];

  /** Files that would be modified */
  readonly modifies: PreviewFile[];

  /** Files unchanged (omitted from output by default) */
  readonly noops: PreviewFile[];

  /** All files in plan */
  readonly allFiles: PreviewFile[];

  /** Whether any modifications would occur (requires --force) */
  readonly hasModifications: boolean;
}

/**
 * Parameters for computing a preview.
 */
export interface ComputePreviewParams {
  /** Absolute path to the template directory */
  readonly templateDir: string;

  /** Absolute path to the target directory */
  readonly targetDir: string;

  /** Data to pass to Handlebars templates */
  readonly data: Record<string, unknown>;

  /** Optional rename rules for file/directory names */
  readonly renameRules?: RenameRules;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum bytes to read for binary detection.
 */
const BINARY_CHECK_SIZE = 8192;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Checks if a buffer contains binary content (NUL bytes).
 */
function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

/**
 * Detects if a file is binary by reading initial bytes.
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  const fileHandle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(BINARY_CHECK_SIZE);
    const { bytesRead } = await fileHandle.read(buffer, 0, BINARY_CHECK_SIZE, 0);
    return isBinaryBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await fileHandle.close();
  }
}

/**
 * Applies rename rules to a path, replacing all placeholders.
 */
function applyRenameRules(relativePath: string, rules?: RenameRules): string {
  if (!rules || Object.keys(rules.replacements).length === 0) {
    return relativePath;
  }

  const sortedKeys = Object.keys(rules.replacements).sort((a, b) => b.length - a.length);

  let result = relativePath;
  for (const key of sortedKeys) {
    const value = rules.replacements[key];
    result = result.split(key).join(value);
  }

  return result;
}

/**
 * Renders a Handlebars template string with the given data.
 */
function renderTemplate(content: string, data: Record<string, unknown>, filePath: string): string {
  try {
    const template = Handlebars.compile(content);
    return template(data);
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err));
    throw new ScaffoldError(
      `Failed to render template: ${filePath}`,
      "RENDER_TEMPLATE_ERROR",
      { filePath },
      undefined,
      `Template "${filePath}" has invalid Handlebars syntax: ${cause.message}`,
      cause,
      true,
    );
  }
}

/**
 * Normalizes line endings to LF for consistent comparison.
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Checks if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// PreviewPlanner Class
// =============================================================================

/**
 * Computes a preview of generation operations without writing to disk.
 *
 * For each file in the render plan:
 * - CREATE: Target file doesn't exist
 * - MODIFY: Target exists and content differs
 * - NOOP: Target exists and content matches
 */
export class PreviewPlanner {
  /**
   * Computes a preview report for the given parameters.
   *
   * This renders all templates in memory and compares with existing
   * target files to determine what would happen during generation.
   *
   * @param params - Preview parameters
   * @returns Preview report with file operations
   */
  async computePreview(params: ComputePreviewParams): Promise<PreviewReport> {
    const { templateDir, targetDir, data, renameRules } = params;

    // Validate template directory exists
    try {
      await fs.access(templateDir);
    } catch {
      throw new ScaffoldError(
        `Template directory does not exist: ${templateDir}`,
        "RENDER_TEMPLATE_DIR_NOT_FOUND",
        { templateDir },
        undefined,
        `The template directory "${templateDir}" does not exist or is not accessible.`,
        undefined,
        true,
      );
    }

    // Enumerate all files in template directory
    const templateFiles = await fg("**/*", {
      cwd: templateDir,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    const creates: PreviewFile[] = [];
    const modifies: PreviewFile[] = [];
    const noops: PreviewFile[] = [];

    for (const srcRelativePath of templateFiles) {
      const srcAbsolutePath = path.join(templateDir, srcRelativePath);
      const destRelativePath = applyRenameRules(srcRelativePath, renameRules);
      const destAbsolutePath = path.join(targetDir, destRelativePath);

      // Check if source is binary
      const binary = await isBinaryFile(srcAbsolutePath);

      // Determine operation type
      let operation: FileOperation;

      const targetExists = await fileExists(destAbsolutePath);

      if (!targetExists) {
        operation = "create";
      } else {
        // Compare content
        if (binary) {
          // For binary files, compare raw bytes
          const srcContent = await fs.readFile(srcAbsolutePath);
          const destContent = await fs.readFile(destAbsolutePath);
          operation = srcContent.equals(destContent) ? "noop" : "modify";
        } else {
          // For text files, render and compare (normalized)
          const srcRaw = await fs.readFile(srcAbsolutePath, "utf-8");
          const renderedContent = renderTemplate(srcRaw, data, srcRelativePath);
          const destContent = await fs.readFile(destAbsolutePath, "utf-8");

          const normalizedRendered = normalizeLineEndings(renderedContent);
          const normalizedDest = normalizeLineEndings(destContent);

          operation = normalizedRendered === normalizedDest ? "noop" : "modify";
        }
      }

      const previewFile: PreviewFile = {
        relativePath: destRelativePath,
        absolutePath: destAbsolutePath,
        operation,
        isBinary: binary,
        sourceTemplate: srcRelativePath,
      };

      switch (operation) {
        case "create":
          creates.push(previewFile);
          break;
        case "modify":
          modifies.push(previewFile);
          break;
        case "noop":
          noops.push(previewFile);
          break;
      }
    }

    const allFiles = [...creates, ...modifies, ...noops];

    const summary: PreviewSummary = {
      create: creates.length,
      modify: modifies.length,
      noop: noops.length,
      total: allFiles.length,
    };

    return {
      targetDir,
      summary,
      creates,
      modifies,
      noops,
      allFiles,
      hasModifications: modifies.length > 0,
    };
  }
}
