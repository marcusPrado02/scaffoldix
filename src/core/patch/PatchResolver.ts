/**
 * Patch Resolver - Bridges manifest patches to PatchEngine operations.
 *
 * This module resolves patch content from manifest definitions, handling:
 * - Inline contentTemplate: Rendered via Handlebars with generation inputs
 * - External path: Read from pack storage, then rendered via Handlebars
 *
 * The resolver produces PatchEngine-ready operations where `content` is a
 * final string (no further template processing needed).
 *
 * ## Separation of Concerns
 *
 * - ManifestLoader: Schema validation only
 * - PatchResolver: Content resolution + Handlebars rendering
 * - PatchEngine: Pure file patching, no template knowledge
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import Handlebars from "handlebars";
import { ScaffoldError } from "../errors/errors.js";
import type { PatchOperation as ManifestPatch } from "../manifest/ManifestLoader.js";
import type { PatchOperation as EnginePatch } from "./PatchEngine.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Input for resolving a single patch.
 */
export interface ResolvePatchInput {
  /** The manifest patch definition */
  readonly patch: ManifestPatch;

  /** Data for Handlebars rendering (same as generation inputs) */
  readonly data: Record<string, unknown>;

  /** Absolute path to the installed pack directory in store */
  readonly packStorePath: string;
}

/**
 * Input for resolving multiple patches.
 */
export interface ResolveAllPatchesInput {
  /** Array of manifest patch definitions */
  readonly patches: readonly ManifestPatch[];

  /** Data for Handlebars rendering */
  readonly data: Record<string, unknown>;

  /** Absolute path to the installed pack directory in store */
  readonly packStorePath: string;
}

/**
 * Result of resolving patches.
 */
export interface ResolvedPatchesResult {
  /** PatchEngine-ready operations */
  readonly operations: EnginePatch[];

  /** Count of patches resolved */
  readonly count: number;
}

// =============================================================================
// PatchResolver Class
// =============================================================================

/**
 * Resolves manifest patch definitions into PatchEngine-ready operations.
 *
 * @example
 * ```typescript
 * const resolver = new PatchResolver();
 *
 * const result = await resolver.resolveAll({
 *   patches: archetype.patches,
 *   data: { moduleName: "User" },
 *   packStorePath: "/path/to/pack/store",
 * });
 *
 * // result.operations are ready for PatchEngine.applyAll()
 * ```
 */
export class PatchResolver {
  /**
   * Resolves multiple patches in order.
   *
   * @param input - Patches, data, and pack store path
   * @returns Resolved operations ready for PatchEngine
   * @throws ScaffoldError if content resolution fails
   */
  async resolveAll(input: ResolveAllPatchesInput): Promise<ResolvedPatchesResult> {
    const { patches, data, packStorePath } = input;
    const operations: EnginePatch[] = [];

    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i];
      const operation = await this.resolvePatch(
        {
          patch,
          data,
          packStorePath,
        },
        i,
      );
      operations.push(operation);
    }

    return {
      operations,
      count: operations.length,
    };
  }

  /**
   * Resolves a single patch to a PatchEngine operation.
   *
   * @param input - Patch, data, and pack store path
   * @param index - Optional patch index for error messages
   * @returns PatchEngine-ready operation
   * @throws ScaffoldError if content resolution fails
   */
  private async resolvePatch(input: ResolvePatchInput, index?: number): Promise<EnginePatch> {
    const { patch, data, packStorePath } = input;

    // Resolve content from contentTemplate or path
    const content = await this.resolveContent(patch, data, packStorePath, index);

    // Build the engine operation based on kind
    switch (patch.kind) {
      case "marker_insert":
        return {
          kind: "marker_insert",
          file: patch.file,
          idempotencyKey: patch.idempotencyKey,
          markerStart: patch.markerStart,
          markerEnd: patch.markerEnd,
          content,
        };

      case "marker_replace":
        return {
          kind: "marker_replace",
          file: patch.file,
          idempotencyKey: patch.idempotencyKey,
          markerStart: patch.markerStart,
          markerEnd: patch.markerEnd,
          content,
        };

      case "append_if_missing":
        return {
          kind: "append_if_missing",
          file: patch.file,
          idempotencyKey: patch.idempotencyKey,
          content,
        };

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = patch;
        throw new Error(`Unknown patch kind: ${(_exhaustive as ManifestPatch).kind}`);
    }
  }

  /**
   * Resolves patch content from contentTemplate or path.
   *
   * @param patch - The manifest patch
   * @param data - Data for Handlebars rendering
   * @param packStorePath - Pack storage directory
   * @param index - Optional patch index for error context
   * @returns Rendered content string
   */
  private async resolveContent(
    patch: ManifestPatch,
    data: Record<string, unknown>,
    packStorePath: string,
    index?: number,
  ): Promise<string> {
    let templateContent: string;

    if (patch.contentTemplate !== undefined) {
      // Use inline template
      templateContent = patch.contentTemplate;
    } else if (patch.path !== undefined) {
      // Read from pack storage
      templateContent = await this.readPatchFile(patch.path, packStorePath, patch, index);
    } else {
      // Schema should prevent this, but defensive check
      const patchRef = index !== undefined ? `patches[${index}]` : patch.idempotencyKey;
      throw new ScaffoldError(
        `Patch missing content source`,
        "PATCH_CONTENT_MISSING",
        {
          patchRef,
          idempotencyKey: patch.idempotencyKey,
          file: patch.file,
        },
        undefined,
        `Patch '${patch.idempotencyKey}' has neither contentTemplate nor path. ` +
          `Provide exactly one of these fields in the manifest.`,
        undefined,
        true,
      );
    }

    // Render with Handlebars
    return this.renderTemplate(templateContent, data, patch, index);
  }

  /**
   * Reads a patch template file from pack storage.
   *
   * @param relativePath - Path relative to pack root
   * @param packStorePath - Pack storage directory
   * @param patch - The manifest patch (for error context)
   * @param index - Optional patch index for error context
   * @returns File content
   */
  private async readPatchFile(
    relativePath: string,
    packStorePath: string,
    patch: ManifestPatch,
    index?: number,
  ): Promise<string> {
    const absolutePath = path.join(packStorePath, relativePath);
    const patchRef = index !== undefined ? `patches[${index}]` : patch.idempotencyKey;

    try {
      return await fs.readFile(absolutePath, "utf-8");
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        `Patch template file not found`,
        "PATCH_FILE_NOT_FOUND",
        {
          patchRef,
          idempotencyKey: patch.idempotencyKey,
          path: relativePath,
          absolutePath,
          file: patch.file,
        },
        undefined,
        `Patch '${patch.idempotencyKey}' references template file '${relativePath}' ` +
          `but it was not found at ${absolutePath}. ` +
          `Ensure the file exists in the pack.`,
        cause,
        true,
      );
    }
  }

  /**
   * Renders template content with Handlebars.
   *
   * @param template - Template string
   * @param data - Data for rendering
   * @param patch - The manifest patch (for error context)
   * @param index - Optional patch index for error context
   * @returns Rendered content
   */
  private renderTemplate(
    template: string,
    data: Record<string, unknown>,
    patch: ManifestPatch,
    index?: number,
  ): string {
    const patchRef = index !== undefined ? `patches[${index}]` : patch.idempotencyKey;

    try {
      const compiled = Handlebars.compile(template, { strict: false });
      return compiled(data);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        `Failed to render patch template`,
        "PATCH_RENDER_ERROR",
        {
          patchRef,
          idempotencyKey: patch.idempotencyKey,
          file: patch.file,
          reason: cause.message,
        },
        undefined,
        `Patch '${patch.idempotencyKey}' failed to render: ${cause.message}. ` +
          `Check the template syntax and ensure all referenced variables are provided.`,
        cause,
        true,
      );
    }
  }
}
