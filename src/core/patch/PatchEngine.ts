/**
 * Patch Engine - Marker-based, Idempotent File Patching.
 *
 * This module provides a standalone engine for safely modifying existing files
 * using explicit markers and idempotency keys. It is completely isolated from
 * the Renderer - no template rendering occurs here.
 *
 * ## Supported Operations
 *
 * - `marker_insert`: Insert content between markers
 * - `marker_replace`: Replace content between markers
 * - `append_if_missing`: Append content to end of file if not present
 *
 * ## Idempotency
 *
 * All operations use an explicit "stamp" comment based on `idempotencyKey`:
 * ```
 * SCAFFOLDIX_PATCH:<idempotencyKey>
 * ```
 *
 * If the stamp is present in the file, the operation is skipped to prevent
 * duplicate modifications.
 *
 * ## Atomic Writes
 *
 * All file modifications use atomic writes (temp file + rename) to prevent
 * corruption on failure.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Constants
// =============================================================================

/** Stamp prefix for idempotency detection. */
const STAMP_PREFIX = "SCAFFOLDIX_PATCH:";

// =============================================================================
// Types
// =============================================================================

/**
 * Base fields common to all patch operations.
 */
interface PatchOperationBase {
  /** Target file path relative to rootDir. */
  readonly file: string;

  /** Unique key for idempotency checking. */
  readonly idempotencyKey: string;
}

/**
 * Insert content between markers.
 *
 * Content is inserted immediately after markerStart.
 */
export interface MarkerInsertOperation extends PatchOperationBase {
  readonly kind: "marker_insert";

  /** Start marker string to find in the file. */
  readonly markerStart: string;

  /** End marker string to find in the file. */
  readonly markerEnd: string;

  /** Content to insert (already resolved, no Handlebars processing). */
  readonly content: string;
}

/**
 * Replace content between markers.
 *
 * Everything between markerStart and markerEnd is replaced with content.
 */
export interface MarkerReplaceOperation extends PatchOperationBase {
  readonly kind: "marker_replace";

  /** Start marker string to find in the file. */
  readonly markerStart: string;

  /** End marker string to find in the file. */
  readonly markerEnd: string;

  /** Content to insert (already resolved, no Handlebars processing). */
  readonly content: string;
}

/**
 * Append content to end of file if not already present.
 */
export interface AppendIfMissingOperation extends PatchOperationBase {
  readonly kind: "append_if_missing";

  /** Content to append (already resolved, no Handlebars processing). */
  readonly content: string;
}

/**
 * Union type of all supported patch operations.
 */
export type PatchOperation =
  | MarkerInsertOperation
  | MarkerReplaceOperation
  | AppendIfMissingOperation;

/**
 * Options for applying patches.
 */
export interface PatchOptions {
  /** Absolute path for resolving relative file paths. */
  readonly rootDir: string;

  /**
   * Strict mode behavior.
   * - true (default): Throw on missing markers or missing files.
   * - false: Skip missing markers, create missing files.
   */
  readonly strict?: boolean;

  /**
   * Newline normalization strategy.
   * - "preserve" (default): Detect and preserve existing line endings.
   * - "lf": Force LF line endings.
   * - "crlf": Force CRLF line endings.
   */
  readonly newline?: "preserve" | "lf" | "crlf";
}

/**
 * Result of applying a single patch.
 */
export interface PatchApplyResult {
  /** Status of the patch application. */
  readonly status: "applied" | "skipped" | "failed";

  /** Reason for skip or failure. */
  readonly reason?: string;

  /** Target file path (relative). */
  readonly file: string;

  /** Operation kind. */
  readonly kind: PatchOperation["kind"];

  /** Idempotency key used. */
  readonly idempotencyKey: string;
}

/**
 * Summary of applying multiple patches.
 */
export interface PatchApplySummary {
  /** Number of patches successfully applied. */
  readonly applied: number;

  /** Number of patches skipped (already applied). */
  readonly skipped: number;

  /** Number of patches that failed. */
  readonly failed: number;

  /** Individual results for each patch. */
  readonly results: PatchApplyResult[];
}

// =============================================================================
// PatchEngine
// =============================================================================

/**
 * Engine for applying marker-based, idempotent file patches.
 *
 * ## Usage
 *
 * ```typescript
 * const engine = new PatchEngine();
 *
 * // Apply a single patch
 * const result = await engine.applyPatch({
 *   file: "src/index.ts",
 *   kind: "marker_insert",
 *   idempotencyKey: "add-import",
 *   markerStart: "// <IMPORTS:START>",
 *   markerEnd: "// <IMPORTS:END>",
 *   content: 'import { User } from "./models/User";',
 * }, { rootDir: "/path/to/project" });
 *
 * // Apply multiple patches
 * const summary = await engine.applyAll([...patches], { rootDir: "/path/to/project" });
 * ```
 */
export class PatchEngine {
  /**
   * Applies a single patch operation.
   *
   * @param op - The patch operation to apply
   * @param opts - Options including rootDir and strict mode
   * @returns Result indicating success, skip, or failure
   */
  async applyPatch(op: PatchOperation, opts: PatchOptions): Promise<PatchApplyResult> {
    const { rootDir, strict = true } = opts;
    const absolutePath = path.resolve(rootDir, op.file);

    // Check if file exists
    const fileExists = await this.fileExists(absolutePath);

    if (!fileExists) {
      if (strict) {
        throw new ScaffoldError(
          `Target file not found: ${op.file}`,
          "PATCH_FILE_NOT_FOUND",
          { file: op.file, absolutePath },
          undefined,
          `The file '${absolutePath}' does not exist. Ensure the target file exists before applying patches.`,
          undefined,
          true,
        );
      }

      // Non-strict mode: create file with content for append_if_missing
      if (op.kind === "append_if_missing") {
        return await this.applyAppendToNewFile(op, absolutePath);
      }

      // For marker operations, we can't proceed without the file
      return {
        status: "skipped",
        reason: "file_not_found",
        file: op.file,
        kind: op.kind,
        idempotencyKey: op.idempotencyKey,
      };
    }

    // Read file content
    let content = await fs.readFile(absolutePath, "utf-8");
    const originalLineEnding = this.detectLineEnding(content);

    // Check if patch was already applied (idempotency)
    const stamp = this.buildStamp(op.idempotencyKey);
    if (content.includes(stamp)) {
      return {
        status: "skipped",
        reason: "already_applied",
        file: op.file,
        kind: op.kind,
        idempotencyKey: op.idempotencyKey,
      };
    }

    // Apply the operation
    switch (op.kind) {
      case "marker_insert":
        content = await this.applyMarkerInsert(op, content, absolutePath, strict);
        break;

      case "marker_replace":
        content = await this.applyMarkerReplace(op, content, absolutePath, strict);
        break;

      case "append_if_missing":
        content = this.applyAppendIfMissing(op, content, originalLineEnding);
        break;

      default:
        throw new Error(`Unknown patch kind: ${(op as PatchOperation).kind}`);
    }

    // Normalize line endings if needed
    content = this.normalizeLineEndings(content, opts.newline, originalLineEnding);

    // Atomic write
    await this.atomicWrite(absolutePath, content);

    return {
      status: "applied",
      file: op.file,
      kind: op.kind,
      idempotencyKey: op.idempotencyKey,
    };
  }

  /**
   * Applies multiple patches in sequence.
   *
   * @param ops - Array of patch operations
   * @param opts - Options including rootDir and strict mode
   * @returns Summary of all patch applications
   */
  async applyAll(ops: PatchOperation[], opts: PatchOptions): Promise<PatchApplySummary> {
    const results: PatchApplyResult[] = [];
    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const op of ops) {
      try {
        const result = await this.applyPatch(op, opts);
        results.push(result);

        if (result.status === "applied") {
          applied++;
        } else if (result.status === "skipped") {
          skipped++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        results.push({
          status: "failed",
          reason: err instanceof Error ? err.message : String(err),
          file: op.file,
          kind: op.kind,
          idempotencyKey: op.idempotencyKey,
        });
      }
    }

    return { applied, skipped, failed, results };
  }

  // ===========================================================================
  // Private Methods - Operation Implementations
  // ===========================================================================

  /**
   * Applies marker_insert operation.
   * Inserts content immediately after markerStart.
   */
  private async applyMarkerInsert(
    op: MarkerInsertOperation,
    content: string,
    absolutePath: string,
    strict: boolean,
  ): Promise<string> {
    const { markerStart, markerEnd } = op;

    // Find markers
    const startIndex = content.indexOf(markerStart);
    const endIndex = content.indexOf(markerEnd);

    if (startIndex === -1) {
      if (strict) {
        throw new ScaffoldError(
          `Patch markerStart not found in file`,
          "PATCH_MARKER_NOT_FOUND",
          { file: op.file, marker: markerStart, markerType: "markerStart" },
          undefined,
          `The markerStart '${markerStart}' was not found in ${absolutePath}. ` +
            `Ensure the file contains the expected markers.`,
          undefined,
          true,
        );
      }
      return content;
    }

    if (endIndex === -1) {
      if (strict) {
        throw new ScaffoldError(
          `Patch markerEnd not found in file`,
          "PATCH_MARKER_NOT_FOUND",
          { file: op.file, marker: markerEnd, markerType: "markerEnd" },
          undefined,
          `The markerEnd '${markerEnd}' was not found in ${absolutePath}. ` +
            `Ensure the file contains the expected markers.`,
          undefined,
          true,
        );
      }
      return content;
    }

    if (endIndex <= startIndex) {
      if (strict) {
        throw new ScaffoldError(
          `Patch markerEnd appears before markerStart`,
          "PATCH_MARKER_ORDER",
          { file: op.file, markerStart, markerEnd },
          undefined,
          `The markerEnd appears before markerStart in ${absolutePath}. ` +
            `Ensure markers are in the correct order.`,
          undefined,
          true,
        );
      }
      return content;
    }

    // Build stamped content
    const stamp = this.buildStamp(op.idempotencyKey);
    const lineEnding = this.detectLineEnding(content);
    const stampedContent = `${stamp}${lineEnding}${op.content}`;

    // Insert after markerStart
    const insertPoint = startIndex + markerStart.length;
    const before = content.slice(0, insertPoint);
    const after = content.slice(insertPoint);

    // Add line ending after marker if not present
    const needsLeadingNewline = !after.startsWith("\n") && !after.startsWith("\r\n");
    const leadingNewline = needsLeadingNewline ? lineEnding : "";

    return `${before}${leadingNewline}${stampedContent}${after}`;
  }

  /**
   * Applies marker_replace operation.
   * Replaces everything between markerStart and markerEnd.
   */
  private async applyMarkerReplace(
    op: MarkerReplaceOperation,
    content: string,
    absolutePath: string,
    strict: boolean,
  ): Promise<string> {
    const { markerStart, markerEnd } = op;

    // Find markers
    const startIndex = content.indexOf(markerStart);
    const endIndex = content.indexOf(markerEnd);

    if (startIndex === -1) {
      if (strict) {
        throw new ScaffoldError(
          `Patch markerStart not found in file`,
          "PATCH_MARKER_NOT_FOUND",
          { file: op.file, marker: markerStart, markerType: "markerStart" },
          undefined,
          `The markerStart '${markerStart}' was not found in ${absolutePath}. ` +
            `Ensure the file contains the expected markers.`,
          undefined,
          true,
        );
      }
      return content;
    }

    if (endIndex === -1) {
      if (strict) {
        throw new ScaffoldError(
          `Patch markerEnd not found in file`,
          "PATCH_MARKER_NOT_FOUND",
          { file: op.file, marker: markerEnd, markerType: "markerEnd" },
          undefined,
          `The markerEnd '${markerEnd}' was not found in ${absolutePath}. ` +
            `Ensure the file contains the expected markers.`,
          undefined,
          true,
        );
      }
      return content;
    }

    // Build stamped content
    const stamp = this.buildStamp(op.idempotencyKey);
    const lineEnding = this.detectLineEnding(content);
    const stampedContent = `${stamp}${lineEnding}${op.content}`;

    // Replace content between markers
    const before = content.slice(0, startIndex + markerStart.length);
    const after = content.slice(endIndex);

    return `${before}${lineEnding}${stampedContent}${lineEnding}${after}`;
  }

  /**
   * Applies append_if_missing operation.
   * Appends content to end of file with stamp.
   */
  private applyAppendIfMissing(
    op: AppendIfMissingOperation,
    content: string,
    lineEnding: string,
  ): string {
    const stamp = this.buildStamp(op.idempotencyKey);

    // Ensure file ends with newline
    const needsTrailingNewline = content.length > 0 && !content.endsWith("\n");
    const trailingNewline = needsTrailingNewline ? lineEnding : "";

    return `${content}${trailingNewline}${stamp}${lineEnding}${op.content}${lineEnding}`;
  }

  /**
   * Applies append to a new file (non-strict mode).
   */
  private async applyAppendToNewFile(
    op: AppendIfMissingOperation,
    absolutePath: string,
  ): Promise<PatchApplyResult> {
    const stamp = this.buildStamp(op.idempotencyKey);
    const lineEnding = "\n"; // Default for new files
    const content = `${stamp}${lineEnding}${op.content}${lineEnding}`;

    await this.atomicWrite(absolutePath, content);

    return {
      status: "applied",
      file: op.file,
      kind: op.kind,
      idempotencyKey: op.idempotencyKey,
    };
  }

  // ===========================================================================
  // Private Methods - Utilities
  // ===========================================================================

  /**
   * Builds the idempotency stamp string.
   */
  private buildStamp(idempotencyKey: string): string {
    return `// ${STAMP_PREFIX}${idempotencyKey}`;
  }

  /**
   * Detects the line ending style used in content.
   */
  private detectLineEnding(content: string): string {
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfCount = (content.match(/(?<!\r)\n/g) || []).length;

    return crlfCount > lfCount ? "\r\n" : "\n";
  }

  /**
   * Normalizes line endings based on options.
   */
  private normalizeLineEndings(
    content: string,
    newline: PatchOptions["newline"],
    originalEnding: string,
  ): string {
    const targetEnding = newline === "lf" ? "\n" : newline === "crlf" ? "\r\n" : originalEnding;

    if (targetEnding === "\r\n") {
      // First normalize to LF, then convert to CRLF
      return content.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    } else {
      // Normalize to LF
      return content.replace(/\r\n/g, "\n");
    }
  }

  /**
   * Checks if a file exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes content atomically using temp file + rename.
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const random = crypto.randomBytes(8).toString("hex");
    const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${random}`);

    try {
      await fs.writeFile(tempPath, content, "utf-8");
      await fs.rename(tempPath, filePath);
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }
}
