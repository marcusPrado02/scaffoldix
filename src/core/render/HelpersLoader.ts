/**
 * Handlebars Helpers Loader.
 *
 * Loads custom Handlebars helper functions from a pack's `helpers/` directory.
 * Each `.js` or `.cjs` file in the directory is loaded as a module and its
 * default export (or named exports) are registered as helpers.
 *
 * ## Pack helpers directory convention
 *
 * ```
 * my-pack/
 *   helpers/
 *     camelCase.js     ← export default function(str) { ... }
 *     formatDate.js    ← export default function(date, fmt) { ... }
 *     index.js         ← export { camelCase, formatDate }  (bulk registration)
 * ```
 *
 * Helper names are derived from the filename (without extension) unless
 * an `index.js` is used for bulk registration.
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import Handlebars from "handlebars";

// =============================================================================
// Types
// =============================================================================

export interface LoadedHelper {
  readonly name: string;
  readonly fn: Handlebars.HelperDelegate;
}

export interface LoadHelpersResult {
  readonly loaded: LoadedHelper[];
  readonly errors: Array<{ file: string; error: string }>;
}

// =============================================================================
// HelpersLoader
// =============================================================================

/**
 * Loads and registers Handlebars helpers from a pack's helpers/ directory.
 */
export class HelpersLoader {
  /**
   * Loads helpers from a pack directory and registers them with Handlebars.
   *
   * @param packRootDir - Absolute path to the pack root directory
   * @returns Result with loaded helpers and any errors
   */
  static async loadFromPack(packRootDir: string): Promise<LoadHelpersResult> {
    const helpersDir = path.join(packRootDir, "helpers");
    const loaded: LoadedHelper[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    // Check if helpers directory exists
    try {
      const stat = await fs.stat(helpersDir);
      if (!stat.isDirectory()) return { loaded, errors };
    } catch {
      return { loaded, errors }; // No helpers directory — that's fine
    }

    // Find all .js and .cjs helper files
    const entries = await fs.readdir(helpersDir);
    const helperFiles = entries.filter((f) => /\.(js|cjs|mjs)$/.test(f));

    for (const file of helperFiles) {
      const filePath = path.join(helpersDir, file);
      const helperName = path.basename(file, path.extname(file));

      try {
        // Dynamic import (supports both CJS and ESM)
        const mod = await import(filePath) as Record<string, unknown>;

        // Handle index.js with multiple named exports
        if (helperName === "index") {
          for (const [name, fn] of Object.entries(mod)) {
            if (name === "default" && typeof fn === "object" && fn !== null) {
              // default export is an object of helpers
              for (const [hName, hFn] of Object.entries(fn as Record<string, unknown>)) {
                if (typeof hFn === "function") {
                  Handlebars.registerHelper(hName, hFn as Handlebars.HelperDelegate);
                  loaded.push({ name: hName, fn: hFn as Handlebars.HelperDelegate });
                }
              }
            } else if (typeof fn === "function") {
              Handlebars.registerHelper(name, fn as Handlebars.HelperDelegate);
              loaded.push({ name, fn: fn as Handlebars.HelperDelegate });
            }
          }
        } else {
          // Single helper file: use filename as helper name
          const fn = (mod.default ?? mod[helperName]) as Handlebars.HelperDelegate | undefined;
          if (typeof fn === "function") {
            Handlebars.registerHelper(helperName, fn);
            loaded.push({ name: helperName, fn });
          } else {
            errors.push({
              file,
              error: `Helper file must export a function as default or as "${helperName}"`,
            });
          }
        }
      } catch (err) {
        errors.push({
          file,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { loaded, errors };
  }

  /**
   * Unregisters all helpers that were previously loaded from a pack.
   *
   * @param loaded - Array of loaded helpers to unregister
   */
  static unregisterAll(loaded: LoadedHelper[]): void {
    for (const { name } of loaded) {
      Handlebars.unregisterHelper(name);
    }
  }
}
