/**
 * Handlebars Partials Loader.
 *
 * Loads reusable Handlebars partial templates from a pack's `partials/` directory.
 * Partials can then be referenced in templates with `{{> partialName}}`.
 *
 * ## Pack partials directory convention
 *
 * ```
 * my-pack/
 *   partials/
 *     header.hbs       ← {{> header}}
 *     footer.hbs       ← {{> footer}}
 *     imports.ts.hbs   ← {{> imports.ts}}
 * ```
 *
 * Partial names are derived from the filename. The extension is stripped.
 * Dots in the base name are preserved (e.g., `imports.ts.hbs` → `imports.ts`).
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import Handlebars from "handlebars";

// =============================================================================
// Types
// =============================================================================

export interface LoadedPartial {
  readonly name: string;
  readonly source: string;
}

export interface LoadPartialsResult {
  readonly loaded: LoadedPartial[];
  readonly errors: Array<{ file: string; error: string }>;
}

// =============================================================================
// PartialsLoader
// =============================================================================

/**
 * Loads and registers Handlebars partials from a pack's partials/ directory.
 */
export class PartialsLoader {
  /**
   * Loads partials from a pack directory and registers them with Handlebars.
   *
   * @param packRootDir - Absolute path to the pack root directory
   * @returns Result with loaded partials and any errors
   */
  static async loadFromPack(packRootDir: string): Promise<LoadPartialsResult> {
    const partialsDir = path.join(packRootDir, "partials");
    const loaded: LoadedPartial[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    // Check if partials directory exists
    try {
      const stat = await fs.stat(partialsDir);
      if (!stat.isDirectory()) return { loaded, errors };
    } catch {
      return { loaded, errors }; // No partials directory — that's fine
    }

    // Recursively find all partial files
    const entries = await fs.readdir(partialsDir, { recursive: true });
    const partialFiles = entries
      .filter((f) => typeof f === "string" && /\.(hbs|handlebars|html|txt|ts|js|md)$/.test(f))
      .sort() as string[];

    for (const relativePath of partialFiles) {
      const filePath = path.join(partialsDir, relativePath);

      try {
        const source = await fs.readFile(filePath, "utf-8");

        // Derive partial name from relative path:
        // partials/header.hbs       → "header"
        // partials/shared/footer.hbs → "shared/footer"
        const name = relativePath
          .replace(/\.(hbs|handlebars)$/, "") // strip .hbs / .handlebars
          .replace(/\\/g, "/"); // normalize Windows separators

        Handlebars.registerPartial(name, source);
        loaded.push({ name, source });
      } catch (err) {
        errors.push({
          file: relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { loaded, errors };
  }

  /**
   * Unregisters all partials that were previously loaded from a pack.
   *
   * @param loaded - Array of loaded partials to unregister
   */
  static unregisterAll(loaded: LoadedPartial[]): void {
    for (const { name } of loaded) {
      Handlebars.unregisterPartial(name);
    }
  }
}
