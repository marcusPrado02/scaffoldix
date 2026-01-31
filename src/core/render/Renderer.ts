/**
 * Template Renderer for Scaffoldix CLI (v0.1).
 *
 * Renders archetype templates using Handlebars, applies filename renaming rules,
 * and supports dry-run mode for previewing operations without disk writes.
 *
 * ## Features
 *
 * - **Handlebars rendering**: Variables, conditionals, loops in file contents
 * - **Binary detection**: Copies binary files (images, jars) without templating
 * - **Filename renaming**: Transforms paths like `__Entity__` -> `Customer`
 * - **Dry-run mode**: Preview operations without writing to disk
 * - **Path safety**: Prevents path traversal attacks
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import Handlebars from "handlebars";
import fg from "fast-glob";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Rules for renaming files and directories during rendering.
 */
export interface RenameRules {
  /**
   * Key-value pairs for placeholder replacement.
   * Keys are replaced with values in both filenames and directory names.
   *
   * @example
   * ```typescript
   * { __Entity__: "Customer", __entity__: "customer" }
   * ```
   */
  readonly replacements: Record<string, string>;
}

/**
 * Information about a single file operation.
 */
export interface FileEntry {
  /** Relative path from templateDir */
  readonly srcRelativePath: string;

  /** Relative path in targetDir (after renaming) */
  readonly destRelativePath: string;

  /** Absolute path in targetDir (only for written files) */
  readonly destAbsolutePath?: string;

  /** How the file was processed */
  readonly mode: "rendered" | "copied" | "skipped";
}

/**
 * Result of a render operation.
 */
export interface RenderResult {
  /** Files that were actually written (non-dry-run) */
  readonly filesWritten: FileEntry[];

  /** Files that would be written (dry-run) */
  readonly filesPlanned: FileEntry[];

  /** Files that were overwritten (only when force=true) */
  readonly filesOverwritten: FileEntry[];

  /** Files that would be overwritten in dry-run mode (only when force=true) */
  readonly filesWouldOverwrite: FileEntry[];
}

/**
 * Parameters for the renderArchetype function.
 */
export interface RenderParams {
  /** Absolute path to the template directory */
  readonly templateDir: string;

  /** Absolute path to the target output directory */
  readonly targetDir: string;

  /** Data to pass to Handlebars templates */
  readonly data: Record<string, unknown>;

  /** Optional rename rules for file/directory names */
  readonly renameRules?: RenameRules;

  /** If true, don't write files - just return what would be done */
  readonly dryRun?: boolean;

  /**
   * If true, overwrite existing files. If false (default), throw error
   * when a target file already exists.
   */
  readonly force?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum bytes to read for binary detection.
 * We check for NUL bytes in this initial chunk.
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
 * Detects if a file is binary by reading initial bytes and checking for NUL.
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
 * Replacements are applied in order of key length (longest first)
 * to avoid partial matches.
 */
function applyRenameRules(relativePath: string, rules?: RenameRules): string {
  if (!rules || Object.keys(rules.replacements).length === 0) {
    return relativePath;
  }

  // Sort keys by length descending to avoid partial replacement issues
  const sortedKeys = Object.keys(rules.replacements).sort(
    (a, b) => b.length - a.length
  );

  let result = relativePath;
  for (const key of sortedKeys) {
    const value = rules.replacements[key];
    // Replace all occurrences
    result = result.split(key).join(value);
  }

  return result;
}

/**
 * Validates that a path doesn't escape the target directory.
 * Throws if path traversal is detected.
 */
function validateSafePath(
  destRelativePath: string,
  targetDir: string,
  srcRelativePath: string
): void {
  const normalizedPath = path.normalize(destRelativePath);

  // Check for path traversal attempts
  if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    throw new ScaffoldError(
      `Path traversal detected in rename rules`,
      "RENDER_PATH_TRAVERSAL",
      {
        srcRelativePath,
        destRelativePath,
        normalizedPath,
      },
      undefined,
      `Rename rules would place "${srcRelativePath}" outside target directory. ` +
        `Resulting path "${destRelativePath}" is not allowed.`,
      undefined,
      true
    );
  }

  // Double-check the absolute path is within targetDir
  const absoluteDest = path.resolve(targetDir, normalizedPath);
  const resolvedTarget = path.resolve(targetDir);

  if (!absoluteDest.startsWith(resolvedTarget + path.sep) && absoluteDest !== resolvedTarget) {
    throw new ScaffoldError(
      `Path traversal detected in rename rules`,
      "RENDER_PATH_TRAVERSAL",
      {
        srcRelativePath,
        destRelativePath,
        absoluteDest,
        targetDir: resolvedTarget,
      },
      undefined,
      `Rename rules would place "${srcRelativePath}" outside target directory.`,
      undefined,
      true
    );
  }
}

/**
 * Renders a Handlebars template string with the given data.
 */
function renderTemplate(
  content: string,
  data: Record<string, unknown>,
  filePath: string
): string {
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
      true
    );
  }
}

/**
 * Gets file permissions (mode) for preserving during copy.
 */
async function getFileMode(filePath: string): Promise<number> {
  const stat = await fs.stat(filePath);
  return stat.mode;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Renders an archetype's templates to a target directory.
 *
 * ## Process
 *
 * 1. Enumerate all files in templateDir recursively
 * 2. For each file:
 *    a. Apply rename rules to determine destination path
 *    b. Validate path safety (no traversal)
 *    c. Detect if file is binary
 *    d. If text: render with Handlebars
 *    e. If binary: copy as-is
 * 3. If dryRun: return planned operations only
 * 4. If not dryRun: create directories and write files
 *
 * ## Error Handling
 *
 * - Invalid templateDir: Throws with clear message
 * - Template syntax errors: Throws with file path context
 * - Path traversal: Throws before any writes
 *
 * @param params - Rendering parameters
 * @returns Result with planned or written files
 * @throws ScaffoldError on validation or rendering failures
 */
export async function renderArchetype(params: RenderParams): Promise<RenderResult> {
  const {
    templateDir,
    targetDir,
    data,
    renameRules,
    dryRun = false,
    force = false,
  } = params;

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
      true
    );
  }

  // Enumerate all files in template directory
  const files = await fg("**/*", {
    cwd: templateDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const filesPlanned: FileEntry[] = [];
  const filesWritten: FileEntry[] = [];
  const filesOverwritten: FileEntry[] = [];
  const filesWouldOverwrite: FileEntry[] = [];

  // Process each file
  for (const srcRelativePath of files) {
    const srcAbsolutePath = path.join(templateDir, srcRelativePath);

    // Apply rename rules to get destination path
    const destRelativePath = applyRenameRules(srcRelativePath, renameRules);

    // Validate path safety
    validateSafePath(destRelativePath, targetDir, srcRelativePath);

    const destAbsolutePath = path.join(targetDir, destRelativePath);

    // Check if destination file already exists
    let fileExists = false;
    try {
      await fs.access(destAbsolutePath);
      fileExists = true;
    } catch {
      // File does not exist - this is fine
    }

    // If file exists and force is false, throw error
    if (fileExists && !force) {
      throw new ScaffoldError(
        `Cannot overwrite existing file: ${destRelativePath}`,
        "RENDER_FILE_EXISTS",
        { srcRelativePath, destRelativePath, destAbsolutePath }, // details
        undefined, // data
        `Use --force to overwrite existing files.` // hint
      );
    }

    // Detect if file is binary
    const binary = await isBinaryFile(srcAbsolutePath);

    // Get file mode for preserving permissions
    const fileMode = await getFileMode(srcAbsolutePath);

    const entry: FileEntry = {
      srcRelativePath,
      destRelativePath,
      destAbsolutePath,
      mode: binary ? "copied" : "rendered",
    };

    filesPlanned.push(entry);

    // Track files that would be overwritten (for dry-run reporting)
    if (fileExists) {
      if (dryRun) {
        filesWouldOverwrite.push(entry);
      }
    }

    // If dry run, don't write anything
    if (dryRun) {
      continue;
    }

    // Track overwritten files
    if (fileExists) {
      filesOverwritten.push(entry);
    }

    // Ensure destination directory exists
    const destDir = path.dirname(destAbsolutePath);
    await fs.mkdir(destDir, { recursive: true });

    if (binary) {
      // Copy binary file as-is
      await fs.copyFile(srcAbsolutePath, destAbsolutePath);
      await fs.chmod(destAbsolutePath, fileMode);
    } else {
      // Read, render, and write text file
      const content = await fs.readFile(srcAbsolutePath, "utf-8");
      const rendered = renderTemplate(content, data, srcRelativePath);
      await fs.writeFile(destAbsolutePath, rendered, "utf-8");
      await fs.chmod(destAbsolutePath, fileMode);
    }

    filesWritten.push(entry);
  }

  return {
    filesWritten: dryRun ? [] : filesWritten,
    filesPlanned: dryRun ? filesPlanned : [],
    filesOverwritten: dryRun ? [] : filesOverwritten,
    filesWouldOverwrite: dryRun ? filesWouldOverwrite : [],
  };
}
