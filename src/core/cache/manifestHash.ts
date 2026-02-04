/**
 * Manifest Hash Computation for Pack Caching.
 *
 * Computes a stable, deterministic hash from a manifest file for use as a cache key.
 *
 * ## Normalization Rules
 *
 * To ensure the same logical manifest produces the same hash across:
 * - Different operating systems (LF vs CRLF)
 * - Different YAML key ordering (allowed by spec)
 *
 * We normalize by:
 * 1. Parsing the YAML to a JavaScript object
 * 2. Re-serializing with stable key ordering (sorted recursively)
 * 3. Hashing the normalized string
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as crypto from "node:crypto";
import { parse as parseYaml } from "yaml";

// =============================================================================
// Internal Functions
// =============================================================================

/**
 * Recursively sorts object keys for deterministic serialization.
 */
function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    // Arrays preserve order but sort contents if they're objects
    return obj.map(sortObjectKeys);
  }

  if (typeof obj === "object") {
    // Sort object keys and recursively sort values
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();

    for (const key of keys) {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  // Primitives pass through unchanged
  return obj;
}

/**
 * Normalizes content by parsing as YAML and re-serializing with sorted keys.
 */
function normalizeManifestContent(content: string): string {
  // Parse YAML to object
  const parsed = parseYaml(content);

  // Sort keys recursively
  const sorted = sortObjectKeys(parsed);

  // Serialize to JSON with stable formatting
  // JSON is more deterministic than YAML for our purposes
  return JSON.stringify(sorted);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Computes a deterministic SHA-256 hash from a manifest file.
 *
 * The hash is computed from a normalized representation of the manifest,
 * ensuring that:
 * - Same logical content = same hash (regardless of YAML key order)
 * - Cross-platform consistency (LF vs CRLF doesn't matter)
 *
 * @param manifestPath - Absolute path to the manifest file
 * @returns SHA-256 hash as a 64-character hex string
 *
 * @example
 * ```typescript
 * const hash = await computeManifestHash("/path/to/archetype.yaml");
 * console.log(hash); // "a1b2c3..."
 * ```
 */
export async function computeManifestHash(manifestPath: string): Promise<string> {
  // Read file content
  const content = await fs.readFile(manifestPath, "utf-8");

  // Normalize content (handles line endings and key ordering)
  const normalized = normalizeManifestContent(content);

  // Compute SHA-256 hash
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");

  return hash;
}

/**
 * Computes a hash from a manifest content string (for testing).
 *
 * @param content - Manifest content as string
 * @returns SHA-256 hash as a 64-character hex string
 */
export function computeManifestHashFromContent(content: string): string {
  const normalized = normalizeManifestContent(content);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
