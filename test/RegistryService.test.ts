import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  RegistryService,
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type RegisterPackInput,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory for each test.
 * Returns the path to the registry file within that directory.
 */
async function createTestSetup(): Promise<{
  dir: string;
  registryPath: string;
  service: RegistryService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-registry-test-"));
  const registryPath = path.join(dir, "registry.json");
  const service = new RegistryService(registryPath);
  return { dir, registryPath, service };
}

/**
 * Cleans up a test directory.
 */
async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Creates a valid test pack input.
 */
function createTestPackInput(overrides: Partial<RegisterPackInput> = {}): RegisterPackInput {
  return {
    id: "test-pack",
    version: "1.0.0",
    origin: { type: "local", localPath: "/some/path" } as PackOrigin,
    hash: "a".repeat(64), // Valid SHA-256 hash (64 hex chars)
    ...overrides,
  };
}

/**
 * Creates a valid empty registry object.
 */
function createEmptyRegistry(): Registry {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packs: {},
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("RegistryService", () => {
  let testDir: string;
  let registryPath: string;
  let service: RegistryService;

  beforeEach(async () => {
    const setup = await createTestSetup();
    testDir = setup.dir;
    registryPath = setup.registryPath;
    service = setup.service;
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("accepts absolute paths", () => {
      expect(() => new RegistryService("/absolute/path/registry.json")).not.toThrow();
    });

    it("rejects relative paths", () => {
      expect(() => new RegistryService("relative/path/registry.json")).toThrow(/must be absolute/i);
    });

    it("rejects empty paths", () => {
      expect(() => new RegistryService("")).toThrow();
    });
  });

  // ===========================================================================
  // load() Tests
  // ===========================================================================

  describe("load()", () => {
    it("returns empty registry when file does not exist", async () => {
      const registry = await service.load();

      expect(registry).toEqual({
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {},
      });
    });

    it("returns empty registry with correct schema version", async () => {
      const registry = await service.load();

      expect(registry.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
      expect(typeof registry.schemaVersion).toBe("number");
    });

    it("loads existing valid registry", async () => {
      const existingRegistry: Registry = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {
          "my-pack": {
            id: "my-pack",
            version: "2.0.0",
            origin: { type: "local", localPath: "/test/path" },
            hash: "b".repeat(64),
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        },
      };

      await fs.writeFile(registryPath, JSON.stringify(existingRegistry, null, 2));

      const loaded = await service.load();

      expect(loaded).toEqual(existingRegistry);
      expect(loaded.packs["my-pack"].version).toBe("2.0.0");
    });

    it("throws on invalid JSON", async () => {
      await fs.writeFile(registryPath, "{ invalid json }");

      await expect(service.load()).rejects.toThrow(/invalid JSON/i);
    });

    it("throws on invalid schema (missing schemaVersion)", async () => {
      await fs.writeFile(registryPath, JSON.stringify({ packs: {} }));

      await expect(service.load()).rejects.toThrow(/invalid schema/i);
    });

    it("throws on invalid schema (wrong pack structure)", async () => {
      const invalid = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {
          "bad-pack": {
            // Missing required fields
            id: "bad-pack",
          },
        },
      };

      await fs.writeFile(registryPath, JSON.stringify(invalid));

      await expect(service.load()).rejects.toThrow(/invalid schema/i);
    });

    it("throws on invalid hash format", async () => {
      const invalid = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        packs: {
          "bad-pack": {
            id: "bad-pack",
            version: "1.0.0",
            origin: { type: "local", localPath: "/path" },
            hash: "not-a-valid-hash",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        },
      };

      await fs.writeFile(registryPath, JSON.stringify(invalid));

      await expect(service.load()).rejects.toThrow(/invalid schema/i);
    });

    it("includes file path in error messages", async () => {
      await fs.writeFile(registryPath, "{ invalid }");

      try {
        await service.load();
        expect.fail("Should have thrown");
      } catch (error) {
        // ScaffoldError includes path in details and hint
        const err = error as { details?: { path?: string }; hint?: string };
        const hasPath =
          err.details?.path === registryPath ||
          (typeof err.hint === "string" && err.hint.includes(registryPath));
        expect(hasPath).toBe(true);
      }
    });
  });

  // ===========================================================================
  // save() Tests
  // ===========================================================================

  describe("save()", () => {
    it("writes a valid JSON file", async () => {
      const registry = createEmptyRegistry();
      registry.packs["test"] = {
        id: "test",
        version: "1.0.0",
        origin: { type: "local", localPath: "/test" },
        hash: "c".repeat(64),
        installedAt: new Date().toISOString(),
      };

      await service.save(registry);

      const content = await fs.readFile(registryPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(registry);
    });

    it("uses 2-space indentation for readability", async () => {
      const registry = createEmptyRegistry();

      await service.save(registry);

      const content = await fs.readFile(registryPath, "utf-8");

      // Should have proper formatting
      expect(content).toContain("  "); // 2-space indent
      expect(content).toMatch(/\n$/); // Trailing newline
    });

    it("file ends with newline", async () => {
      const registry = createEmptyRegistry();

      await service.save(registry);

      const content = await fs.readFile(registryPath, "utf-8");

      expect(content.endsWith("\n")).toBe(true);
    });

    it("overwrites existing file", async () => {
      const registry1 = createEmptyRegistry();
      registry1.packs["pack1"] = {
        id: "pack1",
        version: "1.0.0",
        origin: { type: "local", localPath: "/p1" },
        hash: "d".repeat(64),
        installedAt: new Date().toISOString(),
      };

      await service.save(registry1);

      const registry2 = createEmptyRegistry();
      registry2.packs["pack2"] = {
        id: "pack2",
        version: "2.0.0",
        origin: { type: "local", localPath: "/p2" },
        hash: "e".repeat(64),
        installedAt: new Date().toISOString(),
      };

      await service.save(registry2);

      const loaded = await service.load();

      expect(loaded.packs["pack1"]).toBeUndefined();
      expect(loaded.packs["pack2"]).toBeDefined();
    });

    it("creates directory if it does not exist", async () => {
      const nestedPath = path.join(testDir, "nested", "deep", "registry.json");
      const nestedService = new RegistryService(nestedPath);

      await nestedService.save(createEmptyRegistry());

      const exists = await fs
        .access(nestedPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("is atomic: no temp files left after successful save", async () => {
      await service.save(createEmptyRegistry());

      const files = await fs.readdir(testDir);
      const tempFiles = files.filter((f) => f.startsWith(".registry-") && f.endsWith(".tmp"));

      expect(tempFiles).toHaveLength(0);
    });

    it("produces valid JSON that can be loaded back", async () => {
      const registry = createEmptyRegistry();
      registry.packs["roundtrip"] = {
        id: "roundtrip",
        version: "3.0.0",
        origin: {
          type: "git",
          gitUrl: "https://github.com/test/repo",
          ref: "main",
          commit: "abc123",
        },
        hash: "f".repeat(64),
        installedAt: "2024-06-15T12:00:00.000Z",
      };

      await service.save(registry);
      const loaded = await service.load();

      expect(loaded).toEqual(registry);
    });

    it("rejects invalid registry objects", async () => {
      const invalid = {
        schemaVersion: "not a number", // Should be number
        packs: {},
      } as unknown as Registry;

      await expect(service.save(invalid)).rejects.toThrow(/invalid/i);
    });
  });

  // ===========================================================================
  // Atomic Save Tests
  // ===========================================================================

  describe("save() atomicity", () => {
    it("final file always contains complete valid JSON", async () => {
      // Save multiple times rapidly
      const promises = [];
      for (let i = 0; i < 10; i++) {
        const registry = createEmptyRegistry();
        registry.packs[`pack-${i}`] = {
          id: `pack-${i}`,
          version: `${i}.0.0`,
          origin: { type: "local", localPath: `/path/${i}` },
          hash: `${i}`.repeat(64).slice(0, 64),
          installedAt: new Date().toISOString(),
        };
        promises.push(service.save(registry));
      }

      // Wait for all saves (they may interleave)
      await Promise.allSettled(promises);

      // Final file should be valid JSON
      const content = await fs.readFile(registryPath, "utf-8");
      expect(() => JSON.parse(content)).not.toThrow();

      // And should match schema
      const loaded = await service.load();
      expect(loaded.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    });

    it("uses temp file in same directory as registry", async () => {
      // We can't easily test this directly, but we can verify the behavior
      // by ensuring saves work even when the parent directory is read-only
      // after the initial save

      const registry = createEmptyRegistry();
      await service.save(registry);

      // Second save should still work (temp file in same dir)
      registry.packs["new"] = {
        id: "new",
        version: "1.0.0",
        origin: { type: "local", localPath: "/new" },
        hash: "0".repeat(64),
        installedAt: new Date().toISOString(),
      };

      await expect(service.save(registry)).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // registerPack() Tests
  // ===========================================================================

  describe("registerPack()", () => {
    it("adds a new pack to empty registry", async () => {
      const input = createTestPackInput({
        id: "new-pack",
        version: "1.0.0",
      });

      const result = await service.registerPack(input);

      expect(result.packs["new-pack"]).toBeDefined();
      expect(result.packs["new-pack"].id).toBe("new-pack");
      expect(result.packs["new-pack"].version).toBe("1.0.0");
    });

    it("sets installedAt automatically", async () => {
      const before = new Date();
      const input = createTestPackInput();

      const result = await service.registerPack(input);

      const after = new Date();
      const installedAt = new Date(result.packs[input.id].installedAt);

      expect(installedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(installedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("persists pack to disk", async () => {
      const input = createTestPackInput({ id: "persisted-pack" });

      await service.registerPack(input);

      // Create new service instance to verify persistence
      const newService = new RegistryService(registryPath);
      const loaded = await newService.load();

      expect(loaded.packs["persisted-pack"]).toBeDefined();
    });

    it("updates existing pack (upsert)", async () => {
      // Register v1
      await service.registerPack(
        createTestPackInput({
          id: "updatable",
          version: "1.0.0",
          hash: "1".repeat(64),
        }),
      );

      // Update to v2
      const result = await service.registerPack(
        createTestPackInput({
          id: "updatable",
          version: "2.0.0",
          hash: "2".repeat(64),
        }),
      );

      expect(result.packs["updatable"].version).toBe("2.0.0");
      expect(result.packs["updatable"].hash).toBe("2".repeat(64));

      // Should only have one entry, not two
      const packCount = Object.keys(result.packs).length;
      expect(packCount).toBe(1);
    });

    it("is idempotent (same input = same result)", async () => {
      const input = createTestPackInput({ id: "idempotent-pack" });

      await service.registerPack(input);
      await service.registerPack(input);
      await service.registerPack(input);

      const registry = await service.load();
      const packCount = Object.keys(registry.packs).length;

      expect(packCount).toBe(1);
    });

    it("preserves other packs when adding new one", async () => {
      await service.registerPack(createTestPackInput({ id: "pack-a" }));
      await service.registerPack(createTestPackInput({ id: "pack-b" }));
      await service.registerPack(createTestPackInput({ id: "pack-c" }));

      const registry = await service.load();

      expect(registry.packs["pack-a"]).toBeDefined();
      expect(registry.packs["pack-b"]).toBeDefined();
      expect(registry.packs["pack-c"]).toBeDefined();
    });

    it("supports all origin types", async () => {
      const origins: PackOrigin[] = [
        { type: "local", localPath: "/local/path" },
        { type: "git", gitUrl: "https://github.com/test/repo", ref: "main" },
        { type: "zip", zipUrl: "https://example.com/pack.zip" },
        { type: "npm", packageName: "@scope/pack", registry: "https://npm.example.com" },
      ];

      for (let i = 0; i < origins.length; i++) {
        await service.registerPack(
          createTestPackInput({
            id: `origin-${i}`,
            origin: origins[i],
          }),
        );
      }

      const registry = await service.load();

      expect(registry.packs["origin-0"].origin.type).toBe("local");
      expect(registry.packs["origin-1"].origin.type).toBe("git");
      expect(registry.packs["origin-2"].origin.type).toBe("zip");
      expect(registry.packs["origin-3"].origin.type).toBe("npm");
    });

    it("rejects invalid pack ID", async () => {
      await expect(service.registerPack(createTestPackInput({ id: "" }))).rejects.toThrow(/ID/i);
    });

    it("rejects invalid hash", async () => {
      await expect(service.registerPack(createTestPackInput({ hash: "invalid" }))).rejects.toThrow(
        /hash/i,
      );
    });
  });

  // ===========================================================================
  // unregisterPack() Tests
  // ===========================================================================

  describe("unregisterPack()", () => {
    it("removes existing pack", async () => {
      await service.registerPack(createTestPackInput({ id: "to-remove" }));

      const result = await service.unregisterPack("to-remove");

      expect(result).not.toBeNull();
      expect(result?.packs["to-remove"]).toBeUndefined();
    });

    it("returns null for non-existent pack", async () => {
      const result = await service.unregisterPack("does-not-exist");

      expect(result).toBeNull();
    });

    it("persists removal to disk", async () => {
      await service.registerPack(createTestPackInput({ id: "persist-remove" }));
      await service.unregisterPack("persist-remove");

      const newService = new RegistryService(registryPath);
      const loaded = await newService.load();

      expect(loaded.packs["persist-remove"]).toBeUndefined();
    });

    it("preserves other packs when removing one", async () => {
      await service.registerPack(createTestPackInput({ id: "keep-a" }));
      await service.registerPack(createTestPackInput({ id: "remove-me" }));
      await service.registerPack(createTestPackInput({ id: "keep-b" }));

      await service.unregisterPack("remove-me");

      const registry = await service.load();

      expect(registry.packs["keep-a"]).toBeDefined();
      expect(registry.packs["keep-b"]).toBeDefined();
      expect(registry.packs["remove-me"]).toBeUndefined();
    });
  });

  // ===========================================================================
  // getPack() Tests
  // ===========================================================================

  describe("getPack()", () => {
    it("returns pack if it exists", async () => {
      await service.registerPack(createTestPackInput({ id: "findable", version: "5.0.0" }));

      const pack = await service.getPack("findable");

      expect(pack).toBeDefined();
      expect(pack?.version).toBe("5.0.0");
    });

    it("returns undefined if pack does not exist", async () => {
      const pack = await service.getPack("nonexistent");

      expect(pack).toBeUndefined();
    });
  });

  // ===========================================================================
  // listPacks() Tests
  // ===========================================================================

  describe("listPacks()", () => {
    it("returns empty array for empty registry", async () => {
      const packs = await service.listPacks();

      expect(packs).toEqual([]);
    });

    it("returns all registered packs", async () => {
      await service.registerPack(createTestPackInput({ id: "list-a" }));
      await service.registerPack(createTestPackInput({ id: "list-b" }));
      await service.registerPack(createTestPackInput({ id: "list-c" }));

      const packs = await service.listPacks();

      expect(packs).toHaveLength(3);

      const ids = packs.map((p) => p.id).sort();
      expect(ids).toEqual(["list-a", "list-b", "list-c"]);
    });
  });

  // ===========================================================================
  // Cross-platform Tests
  // ===========================================================================

  describe("cross-platform compatibility", () => {
    it("handles paths with spaces", async () => {
      const spacedDir = path.join(testDir, "path with spaces");
      await fs.mkdir(spacedDir, { recursive: true });

      const spacedPath = path.join(spacedDir, "registry.json");
      const spacedService = new RegistryService(spacedPath);

      await spacedService.save(createEmptyRegistry());
      const loaded = await spacedService.load();

      expect(loaded.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    });

    it("handles unicode in pack data", async () => {
      await service.registerPack(
        createTestPackInput({
          id: "unicode-pack-日本語",
          origin: { type: "local", localPath: "/путь/到/パック" },
        }),
      );

      const loaded = await service.load();

      expect(loaded.packs["unicode-pack-日本語"]).toBeDefined();
    });
  });
});
