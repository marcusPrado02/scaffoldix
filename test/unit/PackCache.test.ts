/**
 * Pack Cache System (T45) - Tests
 *
 * Tests for the pack index cache including manifest hashing,
 * cache storage, retrieval, and invalidation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-cache-test-"));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Manifest Hash Tests
// =============================================================================

describe("computeManifestHash", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("produces deterministic hash for same content", async () => {
    const { computeManifestHash } = await import("../../src/core/cache/manifestHash.js");

    const manifestPath = path.join(testDir, "manifest.yaml");
    await fs.writeFile(
      manifestPath,
      `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    const hash1 = await computeManifestHash(manifestPath);
    const hash2 = await computeManifestHash(manifestPath);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hash for different content", async () => {
    const { computeManifestHash } = await import("../../src/core/cache/manifestHash.js");

    const manifest1 = path.join(testDir, "manifest1.yaml");
    const manifest2 = path.join(testDir, "manifest2.yaml");

    await fs.writeFile(
      manifest1,
      `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    await fs.writeFile(
      manifest2,
      `pack:
  name: test-pack
  version: 2.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    const hash1 = await computeManifestHash(manifest1);
    const hash2 = await computeManifestHash(manifest2);

    expect(hash1).not.toBe(hash2);
  });

  it("normalizes line endings (LF vs CRLF)", async () => {
    const { computeManifestHash } = await import("../../src/core/cache/manifestHash.js");

    const manifestLF = path.join(testDir, "manifest-lf.yaml");
    const manifestCRLF = path.join(testDir, "manifest-crlf.yaml");

    const content = `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`;

    await fs.writeFile(manifestLF, content);
    await fs.writeFile(manifestCRLF, content.replace(/\n/g, "\r\n"));

    const hashLF = await computeManifestHash(manifestLF);
    const hashCRLF = await computeManifestHash(manifestCRLF);

    expect(hashLF).toBe(hashCRLF);
  });

  it("normalizes key ordering for determinism", async () => {
    const { computeManifestHash } = await import("../../src/core/cache/manifestHash.js");

    const manifest1 = path.join(testDir, "manifest1.yaml");
    const manifest2 = path.join(testDir, "manifest2.yaml");

    // Same content, different key order in YAML
    await fs.writeFile(
      manifest1,
      `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    await fs.writeFile(
      manifest2,
      `pack:
  version: 1.0.0
  name: test-pack
archetypes:
  - templateRoot: templates
    id: default
`,
    );

    const hash1 = await computeManifestHash(manifest1);
    const hash2 = await computeManifestHash(manifest2);

    expect(hash1).toBe(hash2);
  });
});

// =============================================================================
// PackIndex Type Tests
// =============================================================================

describe("PackIndex", () => {
  it("includes required pack metadata fields", async () => {
    const { createPackIndex } = await import("../../src/core/cache/PackIndexCache.js");
    const { loadManifest } = await import("../../src/core/manifest/ManifestLoader.js");

    let testDir: string | undefined;
    try {
      testDir = await createTestDir();

      const manifestPath = path.join(testDir, "archetype.yaml");
      await fs.writeFile(
        manifestPath,
        `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    inputs:
      - name: projectName
        type: string
        required: true
`,
      );
      await fs.mkdir(path.join(testDir, "templates"));

      const manifest = await loadManifest(testDir);
      const packIndex = createPackIndex(manifest, "abc123hash");

      expect(packIndex.packId).toBe("test-pack");
      expect(packIndex.version).toBe("1.0.0");
      expect(packIndex.manifestHash).toBe("abc123hash");
      expect(packIndex.archetypes).toHaveLength(1);
      expect(packIndex.archetypes[0].id).toBe("default");
      expect(packIndex.archetypes[0].templateRoot).toBe("templates");
      expect(packIndex.archetypes[0].inputsCount).toBe(1);
    } finally {
      if (testDir) await cleanupTestDir(testDir);
    }
  });
});

// =============================================================================
// PackIndexCache Service Tests
// =============================================================================

describe("PackIndexCache", () => {
  let testDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    cacheDir = path.join(testDir, "cache");
    await fs.mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("returns undefined for cache miss", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const cache = new PackIndexCache(cacheDir);
    const result = await cache.get("nonexistent-pack", "somehash");

    expect(result).toBeUndefined();
  });

  it("stores and retrieves PackIndex", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const cache = new PackIndexCache(cacheDir);

    const packIndex = {
      packId: "test-pack",
      version: "1.0.0",
      manifestHash: "abc123hash",
      archetypes: [
        {
          id: "default",
          templateRoot: "templates",
          inputsCount: 0,
        },
      ],
    };

    await cache.set("test-pack", "abc123hash", packIndex);
    const result = await cache.get("test-pack", "abc123hash");

    expect(result).toBeDefined();
    expect(result?.packId).toBe("test-pack");
    expect(result?.version).toBe("1.0.0");
  });

  it("returns undefined when hash does not match", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const cache = new PackIndexCache(cacheDir);

    const packIndex = {
      packId: "test-pack",
      version: "1.0.0",
      manifestHash: "abc123hash",
      archetypes: [],
    };

    await cache.set("test-pack", "abc123hash", packIndex);

    // Different hash should miss
    const result = await cache.get("test-pack", "differenthash");
    expect(result).toBeUndefined();
  });

  it("invalidates cache for a pack", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const cache = new PackIndexCache(cacheDir);

    const packIndex = {
      packId: "test-pack",
      version: "1.0.0",
      manifestHash: "abc123hash",
      archetypes: [],
    };

    await cache.set("test-pack", "abc123hash", packIndex);
    await cache.invalidate("test-pack");

    const result = await cache.get("test-pack", "abc123hash");
    expect(result).toBeUndefined();
  });

  it("cache persists across instances", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const packIndex = {
      packId: "test-pack",
      version: "1.0.0",
      manifestHash: "abc123hash",
      archetypes: [],
    };

    // First instance stores
    const cache1 = new PackIndexCache(cacheDir);
    await cache1.set("test-pack", "abc123hash", packIndex);

    // Second instance retrieves
    const cache2 = new PackIndexCache(cacheDir);
    const result = await cache2.get("test-pack", "abc123hash");

    expect(result).toBeDefined();
    expect(result?.packId).toBe("test-pack");
  });

  it("handles special characters in pack names", async () => {
    const { PackIndexCache } = await import("../../src/core/cache/PackIndexCache.js");

    const cache = new PackIndexCache(cacheDir);

    const packIndex = {
      packId: "@org/my-pack",
      version: "1.0.0",
      manifestHash: "abc123hash",
      archetypes: [],
    };

    await cache.set("@org/my-pack", "abc123hash", packIndex);
    const result = await cache.get("@org/my-pack", "abc123hash");

    expect(result).toBeDefined();
    expect(result?.packId).toBe("@org/my-pack");
  });
});

// =============================================================================
// Cache Integration Tests
// =============================================================================

describe("Cache Integration", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("cache invalidates when manifest changes", async () => {
    const { PackIndexCache, createPackIndex } = await import(
      "../../src/core/cache/PackIndexCache.js"
    );
    const { computeManifestHash } = await import("../../src/core/cache/manifestHash.js");
    const { loadManifest } = await import("../../src/core/manifest/ManifestLoader.js");

    const packDir = path.join(testDir, "pack");
    const cacheDir = path.join(testDir, "cache");
    await fs.mkdir(packDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(path.join(packDir, "templates"));

    const manifestPath = path.join(packDir, "archetype.yaml");

    // Create initial manifest
    await fs.writeFile(
      manifestPath,
      `pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    const cache = new PackIndexCache(cacheDir);

    // Load and cache
    const hash1 = await computeManifestHash(manifestPath);
    const manifest1 = await loadManifest(packDir);
    const packIndex1 = createPackIndex(manifest1, hash1);
    await cache.set("test-pack", hash1, packIndex1);

    // Verify cache hit
    const cachedResult = await cache.get("test-pack", hash1);
    expect(cachedResult).toBeDefined();

    // Update manifest
    await fs.writeFile(
      manifestPath,
      `pack:
  name: test-pack
  version: 2.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
    );

    // New hash should miss cache
    const hash2 = await computeManifestHash(manifestPath);
    expect(hash2).not.toBe(hash1);

    const missResult = await cache.get("test-pack", hash2);
    expect(missResult).toBeUndefined();
  });
});
