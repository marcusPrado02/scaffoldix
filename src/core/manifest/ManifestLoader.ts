/**
 * Manifest Loader for Scaffoldix Packs.
 *
 * Loads and validates pack manifests from disk. A pack manifest defines
 * the pack's identity and the archetypes it provides.
 *
 * ## Manifest Resolution
 *
 * Given a pack root directory, the loader looks for manifests in this order:
 * 1. `archetype.yaml` (preferred)
 * 2. `pack.yaml` (fallback)
 *
 * If neither exists, an actionable error is thrown.
 *
 * ## Schema Versioning
 *
 * This implements the v0.1 minimal schema:
 * - pack.name (required)
 * - pack.version (required)
 * - archetypes[] with id and templateRoot (required)
 *
 * Future versions will add more fields while maintaining backward compatibility.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Manifest filenames in order of preference.
 * The loader tries each in order and uses the first one found.
 */
const MANIFEST_FILENAMES = ["archetype.yaml", "pack.yaml"] as const;

// =============================================================================
// Zod Schemas (v0.1 - Minimal)
// =============================================================================

// =============================================================================
// Patch Operation Schemas
// =============================================================================

/**
 * Non-empty string schema (trims and validates non-empty).
 */
const nonEmptyString = (fieldName: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: `${fieldName} cannot be empty` });

/**
 * Validates exactly one of contentTemplate or path is provided.
 */
function validateContentSource(data: { contentTemplate?: string; path?: string }): boolean {
  const hasContentTemplate = data.contentTemplate !== undefined && data.contentTemplate !== "";
  const hasPath = data.path !== undefined && data.path !== "";
  return (hasContentTemplate && !hasPath) || (!hasContentTemplate && hasPath);
}

/**
 * Schema for marker_insert operation.
 *
 * Inserts content immediately after markerStart, before existing content.
 *
 * Required fields:
 * - file: Target file path relative to project root
 * - idempotencyKey: Unique key for idempotency
 * - markerStart: Start marker string to find
 * - markerEnd: End marker string to find
 * - contentTemplate OR path: Exactly one must be provided
 *
 * Optional fields:
 * - description: Human-readable description
 * - strict: Strictness flag (default true at runtime)
 * - when: Reserved for future conditional execution
 */
const MarkerInsertSchema = z.object({
  kind: z.literal("marker_insert"),
  file: nonEmptyString("Patch file"),
  idempotencyKey: nonEmptyString("Patch idempotencyKey"),
  markerStart: nonEmptyString("markerStart"),
  markerEnd: nonEmptyString("markerEnd"),
  /**
   * Inline template content (Handlebars).
   * Will be rendered with generation inputs at execution time.
   */
  contentTemplate: z.string().optional(),
  /**
   * Path to a template file within the pack.
   * Relative to pack root. Will be read and rendered with generation inputs.
   */
  path: z.string().optional(),
  description: z.string().optional(),
  strict: z.boolean().optional(),
  when: z.string().optional(),
}).refine(validateContentSource, {
  message: "Provide exactly one of contentTemplate or path",
});

/**
 * Schema for marker_replace operation.
 *
 * Replaces everything between markerStart and markerEnd with new content.
 */
const MarkerReplaceSchema = z.object({
  kind: z.literal("marker_replace"),
  file: nonEmptyString("Patch file"),
  idempotencyKey: nonEmptyString("Patch idempotencyKey"),
  markerStart: nonEmptyString("markerStart"),
  markerEnd: nonEmptyString("markerEnd"),
  contentTemplate: z.string().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
  strict: z.boolean().optional(),
  when: z.string().optional(),
}).refine(validateContentSource, {
  message: "Provide exactly one of contentTemplate or path",
});

/**
 * Schema for append_if_missing operation.
 *
 * Appends content to end of file if not already present.
 * Does NOT use markers - markerStart/markerEnd are forbidden.
 */
const AppendIfMissingSchema = z.object({
  kind: z.literal("append_if_missing"),
  file: nonEmptyString("Patch file"),
  idempotencyKey: nonEmptyString("Patch idempotencyKey"),
  contentTemplate: z.string().optional(),
  path: z.string().optional(),
  description: z.string().optional(),
  strict: z.boolean().optional(),
  when: z.string().optional(),
}).refine(validateContentSource, {
  message: "Provide exactly one of contentTemplate or path",
});

/**
 * Raw patch schema without marker validation for append_if_missing.
 */
const RawPatchSchema = z.discriminatedUnion("kind", [
  MarkerInsertSchema,
  MarkerReplaceSchema,
  AppendIfMissingSchema,
]);

/**
 * Custom patch schema with validation for forbidden marker fields on append_if_missing.
 *
 * Uses superRefine to validate that append_if_missing does not include markers,
 * providing actionable error messages.
 */
const PatchSchema = z.object({
  kind: z.enum(["marker_insert", "marker_replace", "append_if_missing"]),
  markerStart: z.string().optional(),
  markerEnd: z.string().optional(),
}).passthrough().superRefine((data, ctx) => {
  if (data.kind === "append_if_missing") {
    if (data.markerStart !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "append_if_missing does not use markers. Remove markerStart.",
        path: ["markerStart"],
      });
    }
    if (data.markerEnd !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "append_if_missing does not use markers. Remove markerEnd.",
        path: ["markerEnd"],
      });
    }
  }
}).pipe(RawPatchSchema);

/**
 * Schema for a single archetype definition.
 *
 * An archetype is a template configuration that can be applied to projects.
 */
const ArchetypeSchema = z.object({
  /** Unique identifier for this archetype within the pack */
  id: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Archetype id cannot be empty" }),

  /** Path to the template root directory, relative to pack root */
  templateRoot: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Archetype templateRoot cannot be empty" }),

  /**
   * Optional list of patch operations to apply after template rendering.
   * Patches modify existing files in the target project.
   */
  patches: z.array(PatchSchema).optional(),

  /**
   * Optional list of shell commands to run after generation completes.
   * Commands are executed sequentially in the target directory.
   * Each entry is a shell command string.
   *
   * @example
   * ```yaml
   * postGenerate:
   *   - npm install
   *   - npm run build
   * ```
   */
  postGenerate: z.array(z.string()).optional(),
});

/**
 * Schema for pack metadata.
 */
const PackInfoSchema = z.object({
  /** Pack name (e.g., "react-starter", "@org/my-pack") */
  name: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Pack name cannot be empty" }),

  /**
   * Pack version string.
   * For v0.1, we only require non-empty. Semver validation is a future enhancement.
   */
  version: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "Pack version cannot be empty" }),
});

/**
 * Schema for the full manifest file (v0.1).
 */
const ManifestSchema = z.object({
  /** Pack identity and metadata */
  pack: PackInfoSchema,

  /** List of archetypes provided by this pack */
  archetypes: z
    .array(ArchetypeSchema)
    .refine((arr) => arr.length > 0, { message: "At least one archetype is required" }),
});

// =============================================================================
// Types (derived from Zod schemas)
// =============================================================================

/**
 * Patch operation for marker_insert.
 * Inserts content immediately after markerStart.
 */
export type MarkerInsertPatch = z.infer<typeof MarkerInsertSchema>;

/**
 * Patch operation for marker_replace.
 * Replaces content between markers.
 */
export type MarkerReplacePatch = z.infer<typeof MarkerReplaceSchema>;

/**
 * Patch operation for append_if_missing.
 * Appends content to end of file.
 */
export type AppendIfMissingPatch = z.infer<typeof AppendIfMissingSchema>;

/**
 * Union type of all patch operations.
 * Discriminated on the `kind` field.
 */
export type PatchOperation = MarkerInsertPatch | MarkerReplacePatch | AppendIfMissingPatch;

/** A single archetype definition */
export type Archetype = z.infer<typeof ArchetypeSchema>;

/** Pack identity metadata */
export type PackInfo = z.infer<typeof PackInfoSchema>;

/** The raw manifest structure (what's in the YAML) */
export type ManifestData = z.infer<typeof ManifestSchema>;

/**
 * Full pack manifest with loader metadata.
 *
 * This extends the validated manifest data with information about
 * where it was loaded from, useful for debugging and error messages.
 */
export interface PackManifest extends ManifestData {
  /**
   * Absolute path to the manifest file that was loaded.
   * Either archetype.yaml or pack.yaml.
   */
  readonly manifestPath: string;

  /**
   * Absolute path to the pack root directory.
   * All relative paths in the manifest are resolved from here.
   */
  readonly packRootDir: string;
}

// =============================================================================
// ManifestLoader Class
// =============================================================================

/**
 * Loads and validates pack manifests from disk.
 *
 * @example
 * ```typescript
 * import { ManifestLoader } from "./core/manifest/ManifestLoader.js";
 *
 * const loader = new ManifestLoader();
 * const manifest = await loader.loadFromDir("/path/to/pack");
 *
 * console.log(manifest.pack.name);      // "my-pack"
 * console.log(manifest.manifestPath);   // "/path/to/pack/archetype.yaml"
 * console.log(manifest.archetypes[0].id); // "default"
 * ```
 */
export class ManifestLoader {
  /**
   * Loads a pack manifest from the given directory.
   *
   * The loader looks for manifest files in order of preference:
   * 1. `archetype.yaml`
   * 2. `pack.yaml`
   *
   * @param packRootDir - Absolute path to the pack root directory
   * @returns Validated manifest with loader metadata
   * @throws ScaffoldError if manifest not found, YAML invalid, or schema invalid
   */
  async loadFromDir(packRootDir: string): Promise<PackManifest> {
    // Validate input
    if (!path.isAbsolute(packRootDir)) {
      throw new ScaffoldError(
        "Pack root directory must be an absolute path",
        "MANIFEST_INVALID_PATH",
        { packRootDir },
        undefined,
        `The path "${packRootDir}" is not absolute. Provide a full path to the pack directory.`,
        undefined,
        false // programming error
      );
    }

    // Find the manifest file
    const manifestPath = await this.findManifestFile(packRootDir);

    // Read the file
    const content = await this.readManifestFile(manifestPath, packRootDir);

    // Parse YAML
    const parsed = this.parseYaml(content, manifestPath, packRootDir);

    // Validate schema
    const validated = this.validateSchema(parsed, manifestPath, packRootDir);

    // Return with metadata
    return {
      ...validated,
      manifestPath,
      packRootDir,
    };
  }

  /**
   * Finds the manifest file in the pack root directory.
   *
   * @param packRootDir - Pack root directory
   * @returns Absolute path to the found manifest file
   * @throws ScaffoldError if no manifest file found
   */
  private async findManifestFile(packRootDir: string): Promise<string> {
    for (const filename of MANIFEST_FILENAMES) {
      const candidatePath = path.join(packRootDir, filename);
      try {
        await fs.access(candidatePath);
        return candidatePath;
      } catch {
        // File doesn't exist, try next
        continue;
      }
    }

    // No manifest found
    const expectedFiles = MANIFEST_FILENAMES.join(" or ");
    throw new ScaffoldError(
      "Pack manifest not found",
      "MANIFEST_NOT_FOUND",
      {
        packRootDir,
        expectedFiles: [...MANIFEST_FILENAMES],
      },
      undefined,
      `No manifest file found in ${packRootDir}. ` +
        `Expected ${expectedFiles}. ` +
        `Create archetype.yaml or pack.yaml in the pack root directory.`,
      undefined,
      true
    );
  }

  /**
   * Reads the manifest file content.
   *
   * @param manifestPath - Path to the manifest file
   * @param packRootDir - Pack root (for error context)
   * @returns File content as string
   * @throws ScaffoldError if file cannot be read
   */
  private async readManifestFile(manifestPath: string, packRootDir: string): Promise<string> {
    try {
      return await fs.readFile(manifestPath, "utf-8");
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        "Failed to read manifest file",
        "MANIFEST_READ_ERROR",
        { manifestPath, packRootDir, reason: cause.message },
        undefined,
        `Could not read ${manifestPath}. ${cause.message}`,
        cause,
        true
      );
    }
  }

  /**
   * Parses YAML content into a JavaScript object.
   *
   * @param content - YAML string content
   * @param manifestPath - Path to file (for error context)
   * @param packRootDir - Pack root (for error context)
   * @returns Parsed object
   * @throws ScaffoldError if YAML is syntactically invalid
   */
  private parseYaml(content: string, manifestPath: string, packRootDir: string): unknown {
    try {
      return parseYaml(content);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));

      // Extract YAML-specific error details if available
      let details: Record<string, unknown> = { manifestPath, packRootDir };
      let parseMessage = cause.message;

      if (error instanceof YAMLParseError) {
        details = {
          ...details,
          line: error.linePos?.[0]?.line,
          column: error.linePos?.[0]?.col,
        };
        parseMessage = error.message;
      }

      throw new ScaffoldError(
        "Invalid YAML syntax in manifest",
        "MANIFEST_YAML_ERROR",
        details,
        undefined,
        `Failed to parse ${path.basename(manifestPath)}: ${parseMessage}. ` +
          `Check the YAML syntax in ${manifestPath}.`,
        cause,
        true
      );
    }
  }

  /**
   * Validates the parsed object against the manifest schema.
   *
   * @param parsed - Parsed YAML object
   * @param manifestPath - Path to file (for error context)
   * @param packRootDir - Pack root (for error context)
   * @returns Validated manifest data
   * @throws ScaffoldError if schema validation fails
   */
  private validateSchema(
    parsed: unknown,
    manifestPath: string,
    packRootDir: string
  ): ManifestData {
    const result = ManifestSchema.safeParse(parsed);

    if (!result.success) {
      // Format Zod errors into actionable messages
      const issues = result.error.issues.map((issue) => {
        const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${fieldPath}: ${issue.message}`;
      });

      const issuesSummary = issues.join("; ");

      throw new ScaffoldError(
        "Invalid manifest schema",
        "MANIFEST_SCHEMA_ERROR",
        {
          manifestPath,
          packRootDir,
          issues: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
            code: i.code,
          })),
        },
        undefined,
        `The manifest at ${manifestPath} has validation errors: ${issuesSummary}. ` +
          `Fix the manifest file according to the pack schema.`,
        undefined,
        true
      );
    }

    return result.data;
  }
}

// =============================================================================
// Convenience Export
// =============================================================================

/**
 * Default ManifestLoader instance for simple usage.
 *
 * @example
 * ```typescript
 * import { loadManifest } from "./core/manifest/ManifestLoader.js";
 *
 * const manifest = await loadManifest("/path/to/pack");
 * ```
 */
export async function loadManifest(packRootDir: string): Promise<PackManifest> {
  const loader = new ManifestLoader();
  return loader.loadFromDir(packRootDir);
}
