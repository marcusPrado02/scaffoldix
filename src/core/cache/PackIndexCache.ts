/**
 * Pack Index Cache for Scaffoldix CLI.
 *
 * Caches computed PackIndex data to avoid reprocessing manifests that haven't changed.
 * The cache is keyed by pack ID + manifest hash, ensuring automatic invalidation
 * when manifests are modified.
 *
 * ## Cache Storage
 *
 * Each pack's cached index is stored as a JSON file:
 * `<cacheDir>/<safe-pack-id>.json`
 *
 * The file contains:
 * - PackIndex data
 * - Manifest hash (for validation)
 * - Cache timestamp
 *
 * ## Safety Guarantees
 *
 * - Cache never changes functional behavior (only performance)
 * - Stale cache is automatically detected via hash mismatch
 * - Corrupted cache files are treated as cache misses
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PackManifest } from "../manifest/ManifestLoader.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Cached archetype summary (subset of full archetype data).
 */
export interface ArchetypeSummary {
  /** Archetype identifier */
  readonly id: string;

  /** Template root directory (relative) */
  readonly templateRoot: string;

  /** Number of inputs defined */
  readonly inputsCount: number;

  /** Optional description */
  readonly description?: string;

  /** Optional language tag */
  readonly language?: string;

  /** Optional tags for categorization */
  readonly tags?: readonly string[];
}

/**
 * Cached pack index - lightweight summary for list/search operations.
 */
export interface PackIndex {
  /** Pack identifier */
  readonly packId: string;

  /** Pack version */
  readonly version: string;

  /** Manifest hash used as cache key */
  readonly manifestHash: string;

  /** Optional pack description */
  readonly description?: string;

  /** Optional vendor/author */
  readonly vendor?: string;

  /** Summary of archetypes in this pack */
  readonly archetypes: readonly ArchetypeSummary[];
}

/**
 * Cache entry stored on disk.
 */
interface CacheEntry {
  /** Cache format version for future migrations */
  readonly cacheVersion: number;

  /** Timestamp when cached (ISO 8601) */
  readonly cachedAt: string;

  /** The cached pack index */
  readonly packIndex: PackIndex;
}

// =============================================================================
// Constants
// =============================================================================

/** Current cache format version */
const CACHE_VERSION = 1;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Converts a pack ID to a safe filename.
 * Handles scoped packages like @org/pack-name.
 */
function toSafeFilename(packId: string): string {
  // Replace @ and / with safe characters
  return packId.replace(/@/g, "_at_").replace(/\//g, "_");
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a PackIndex from a loaded manifest.
 *
 * @param manifest - The loaded and validated manifest
 * @param manifestHash - Pre-computed hash of the manifest
 * @returns PackIndex ready for caching
 */
export function createPackIndex(manifest: PackManifest, manifestHash: string): PackIndex {
  const archetypes: ArchetypeSummary[] = manifest.archetypes.map((archetype) => ({
    id: archetype.id,
    templateRoot: archetype.templateRoot,
    inputsCount: archetype.inputs?.length ?? 0,
  }));

  return {
    packId: manifest.pack.name,
    version: manifest.pack.version,
    manifestHash,
    archetypes,
  };
}

// =============================================================================
// PackIndexCache Class
// =============================================================================

/**
 * Cache for pack index data.
 *
 * @example
 * ```typescript
 * const cache = new PackIndexCache(cacheDir);
 *
 * // Check cache before loading manifest
 * const manifestHash = await computeManifestHash(manifestPath);
 * let packIndex = await cache.get(packId, manifestHash);
 *
 * if (!packIndex) {
 *   // Cache miss - load manifest and cache result
 *   const manifest = await loadManifest(packDir);
 *   packIndex = createPackIndex(manifest, manifestHash);
 *   await cache.set(packId, manifestHash, packIndex);
 * }
 * ```
 */
export class PackIndexCache {
  private readonly cacheDir: string;

  /**
   * Creates a new PackIndexCache.
   *
   * @param cacheDir - Directory for cache storage
   */
  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /**
   * Gets a cached PackIndex if it exists and matches the hash.
   *
   * @param packId - Pack identifier
   * @param manifestHash - Expected manifest hash
   * @returns Cached PackIndex or undefined if not found/stale
   */
  async get(packId: string, manifestHash: string): Promise<PackIndex | undefined> {
    const cachePath = this.getCachePath(packId);

    try {
      const content = await fs.readFile(cachePath, "utf-8");
      const entry: CacheEntry = JSON.parse(content);

      // Validate cache entry
      if (entry.cacheVersion !== CACHE_VERSION) {
        // Old cache format - treat as miss
        return undefined;
      }

      if (entry.packIndex.manifestHash !== manifestHash) {
        // Hash mismatch - manifest changed
        return undefined;
      }

      return entry.packIndex;
    } catch {
      // File doesn't exist or is corrupted - cache miss
      return undefined;
    }
  }

  /**
   * Stores a PackIndex in the cache.
   *
   * @param packId - Pack identifier
   * @param manifestHash - Manifest hash (must match packIndex.manifestHash)
   * @param packIndex - PackIndex to cache
   */
  async set(packId: string, manifestHash: string, packIndex: PackIndex): Promise<void> {
    const cachePath = this.getCachePath(packId);

    // Ensure cache directory exists
    await fs.mkdir(this.cacheDir, { recursive: true });

    const entry: CacheEntry = {
      cacheVersion: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      packIndex: {
        ...packIndex,
        manifestHash, // Ensure hash is stored
      },
    };

    // Write atomically (write to temp, then rename)
    const tempPath = `${cachePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(entry, null, 2));
    await fs.rename(tempPath, cachePath);
  }

  /**
   * Removes a pack from the cache.
   *
   * @param packId - Pack identifier to invalidate
   */
  async invalidate(packId: string): Promise<void> {
    const cachePath = this.getCachePath(packId);

    try {
      await fs.unlink(cachePath);
    } catch {
      // File doesn't exist - already invalidated
    }
  }

  /**
   * Clears all cached entries.
   */
  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => fs.unlink(path.join(this.cacheDir, f)).catch(() => {})),
      );
    } catch {
      // Directory doesn't exist - nothing to clear
    }
  }

  /**
   * Gets the cache file path for a pack.
   */
  private getCachePath(packId: string): string {
    const filename = `${toSafeFilename(packId)}.json`;
    return path.join(this.cacheDir, filename);
  }
}
