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
