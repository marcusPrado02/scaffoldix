import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackRemove,
  formatPackRemoveSuccess,
  type PackRemoveInput,
  type PackRemoveDependencies,
  type PackRemoveResult,
} from "../src/cli/handlers/packRemoveHandler.js";
import {
  RegistryService,
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";
import type { StoreLogger } from "../src/core/store/StoreService.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory.
 */
async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-${prefix}-`));
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
 * Creates test dependencies with isolated registry and packs directory.
 */
async function createTestDependencies(): Promise<{
  storeDir: string;
  packsDir: string;
  deps: PackRemoveDependencies;
  registryFile: string;
  logger: StoreLogger;
}> {
  const storeDir = await createTestDir("remove-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  // Create packs directory
  await fs.mkdir(packsDir, { recursive: true });

  const logger: StoreLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };

  const deps: PackRemoveDependencies = {
    registryFile,
    packsDir,
    logger,
  };

  return { storeDir, packsDir, deps, registryFile, logger };
}

/**
 * Creates a valid registry with given packs.
 */
function createRegistry(
  packs: Array<{
    id: string;
    version: string;
    origin: PackOrigin;
    hash?: string;
    installedAt?: string;
  }>,
): Registry {
  const packsRecord: Registry["packs"] = {};

  for (const pack of packs) {
    packsRecord[pack.id] = {
      id: pack.id,
      version: pack.version,
      origin: pack.origin,
      hash: pack.hash ?? "a".repeat(64),
      installedAt: pack.installedAt ?? "2024-01-15T10:30:00.000Z",
    };
  }

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packs: packsRecord,
  };
}

/**
 * Writes a registry to a file.
 */
async function writeRegistry(registryFile: string, registry: Registry): Promise<void> {
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2));
}

/**
 * Creates a fake pack directory structure in the store.
 */
async function createFakePackStore(
  packsDir: string,
  packId: string,
  hash: string,
): Promise<string> {
  // Sanitize pack ID same way as StoreService
  const sanitizedId = packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
  const packDir = path.join(packsDir, sanitizedId, hash);

  await fs.mkdir(packDir, { recursive: true });

  // Create a minimal archetype.yaml
  await fs.writeFile(
    path.join(packDir, "archetype.yaml"),
    `pack:
  name: ${packId}
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates/default
`,
  );

  // Create templates directory
  await fs.mkdir(path.join(packDir, "templates", "default"), { recursive: true });

  return packDir;
}

/**
 * Checks if a directory exists.
 */
async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dir);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("packRemoveHandler", () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTestDir(dir);
    }
    testDirs.length = 0;
  });

  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  // ===========================================================================
  // A) Removes existing pack
  // ===========================================================================

  describe("removes existing pack", () => {
    it("removes pack directory from store", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "to-remove";
      const hash = "a".repeat(64);

      // Create fake pack in store
      const packDir = await createFakePackStore(packsDir, packId, hash);
      expect(await directoryExists(packDir)).toBe(true);

      // Create registry entry pointing to that pack
      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Execute remove
      const result = await handlePackRemove({ packId }, deps);

      // Assert pack directory is gone
      expect(await directoryExists(packDir)).toBe(false);
      expect(result.status).toBe("removed");
      expect(result.packId).toBe(packId);
    });

    it("removes pack entry from registry", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "to-remove";
      const hash = "a".repeat(64);

      // Create fake pack in store
      await createFakePackStore(packsDir, packId, hash);

      // Create registry entry
      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Execute remove
      await handlePackRemove({ packId }, deps);

      // Load registry with new service instance to verify persistence
      const newService = new RegistryService(registryFile);
      const loadedRegistry = await newService.load();

      expect(loadedRegistry.packs[packId]).toBeUndefined();
    });

    it("returns removed pack details in result", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "detailed-pack";
      const hash = "b".repeat(64);
      const version = "2.3.4";

      // Create fake pack in store
      const packDir = await createFakePackStore(packsDir, packId, hash);

      // Create registry entry
      const registry = createRegistry([
        {
          id: packId,
          version,
          origin: { type: "local", localPath: "/original/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Execute remove
      const result = await handlePackRemove({ packId }, deps);

      expect(result.packId).toBe(packId);
      expect(result.version).toBe(version);
      expect(result.hash).toBe(hash);
      expect(result.removedPath).toBe(packDir);
      expect(result.status).toBe("removed");
    });
  });

  // ===========================================================================
  // B) Pack does not exist
  // ===========================================================================

  describe("pack does not exist", () => {
    it("throws actionable error when pack not found", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Empty registry (no packs)

      await expect(handlePackRemove({ packId: "nonexistent" }, deps)).rejects.toMatchObject({
        code: "PACK_NOT_FOUND",
      });
    });

    it("error message includes pack ID and suggests pack list", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      try {
        await handlePackRemove({ packId: "missing-pack" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("missing-pack");
        expect(err.hint).toContain("scaffoldix pack list");
      }
    });

    it("error includes details with packId", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      try {
        await handlePackRemove({ packId: "not-there" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.packId).toBe("not-there");
      }
    });
  });

  // ===========================================================================
  // C) Safety: path traversal prevention
  // ===========================================================================

  describe("safety: path traversal prevention", () => {
    it("sanitizes path traversal attempts in packId (defense in depth)", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Malicious packId attempting path traversal
      // The sanitization converts "../" to "__.." which stays safe
      const maliciousPackId = "../../../tmp/malicious";
      const hash = "c".repeat(64);

      // Create a directory outside packsDir that could be targeted if not sanitized
      const targetDir = path.join(storeDir, "should-not-delete");
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, "important.txt"), "don't delete me");

      // Create the sanitized pack directory (this is where it would actually go)
      await createFakePackStore(packsDir, maliciousPackId, hash);

      // Create registry entry with malicious packId
      const registry = createRegistry([
        {
          id: maliciousPackId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Should succeed because path traversal is sanitized
      const result = await handlePackRemove({ packId: maliciousPackId }, deps);

      // Removal should succeed (sanitized path is safe)
      expect(result.status).toBe("removed");

      // The outside directory should still exist (wasn't touched)
      expect(await directoryExists(targetDir)).toBe(true);
    });

    it("allows legitimate scoped package names with slashes", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Legitimate scoped package (slashes are sanitized to __)
      const packId = "@myorg/my-pack";
      const hash = "d".repeat(64);

      // Create the pack in store (sanitized path)
      await createFakePackStore(packsDir, packId, hash);

      // Create registry entry
      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Should succeed (no security error)
      const result = await handlePackRemove({ packId }, deps);
      expect(result.status).toBe("removed");
    });

    it("double-checks computed path is inside packsDir (belt and suspenders)", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Create a valid pack to verify the safety check runs
      const packId = "normal-pack";
      const hash = "e".repeat(64);
      await createFakePackStore(packsDir, packId, hash);

      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Should succeed - demonstrating the safety check passes for valid paths
      const result = await handlePackRemove({ packId }, deps);
      expect(result.status).toBe("removed");
    });
  });

  // ===========================================================================
  // D) Preserves other packs
  // ===========================================================================

  describe("preserves other packs", () => {
    it("does not remove other packs from registry", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashA = "a".repeat(64);
      const hashB = "b".repeat(64);
      const hashC = "c".repeat(64);

      // Create packs in store
      await createFakePackStore(packsDir, "keep-a", hashA);
      await createFakePackStore(packsDir, "remove-me", hashB);
      await createFakePackStore(packsDir, "keep-c", hashC);

      // Create registry with all three
      const registry = createRegistry([
        { id: "keep-a", version: "1.0.0", origin: { type: "local", localPath: "/a" }, hash: hashA },
        {
          id: "remove-me",
          version: "2.0.0",
          origin: { type: "local", localPath: "/b" },
          hash: hashB,
        },
        { id: "keep-c", version: "3.0.0", origin: { type: "local", localPath: "/c" }, hash: hashC },
      ]);
      await writeRegistry(registryFile, registry);

      // Remove one pack
      await handlePackRemove({ packId: "remove-me" }, deps);

      // Verify other packs still in registry
      const newService = new RegistryService(registryFile);
      const loadedRegistry = await newService.load();

      expect(loadedRegistry.packs["keep-a"]).toBeDefined();
      expect(loadedRegistry.packs["keep-c"]).toBeDefined();
      expect(loadedRegistry.packs["remove-me"]).toBeUndefined();
    });

    it("does not remove other pack directories from store", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashA = "a".repeat(64);
      const hashB = "b".repeat(64);

      // Create packs in store
      const packDirA = await createFakePackStore(packsDir, "keep-pack", hashA);
      const packDirB = await createFakePackStore(packsDir, "remove-pack", hashB);

      // Create registry
      const registry = createRegistry([
        {
          id: "keep-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/a" },
          hash: hashA,
        },
        {
          id: "remove-pack",
          version: "2.0.0",
          origin: { type: "local", localPath: "/b" },
          hash: hashB,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Remove one pack
      await handlePackRemove({ packId: "remove-pack" }, deps);

      // Verify kept pack directory still exists
      expect(await directoryExists(packDirA)).toBe(true);
      expect(await directoryExists(packDirB)).toBe(false);
    });
  });

  // ===========================================================================
  // E) Handles missing store path gracefully
  // ===========================================================================

  describe("handles missing store path gracefully", () => {
    it("removes registry entry even if store path does not exist", async () => {
      const { storeDir, packsDir, deps, registryFile, logger } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "orphaned-pack";
      const hash = "e".repeat(64);

      // Create registry entry WITHOUT creating the store directory
      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/original/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Store directory doesn't exist (orphaned registry entry)
      const expectedPath = path.join(packsDir, packId, hash);
      expect(await directoryExists(expectedPath)).toBe(false);

      // Should succeed and remove registry entry
      const result = await handlePackRemove({ packId }, deps);

      expect(result.status).toBe("removed");

      // Registry entry should be gone
      const newService = new RegistryService(registryFile);
      const loadedRegistry = await newService.load();
      expect(loadedRegistry.packs[packId]).toBeUndefined();

      // Should have logged a warning
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // F) Prunes empty parent directory
  // ===========================================================================

  describe("prunes empty parent directory", () => {
    it("removes empty packId directory after removing last version", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "single-version-pack";
      const hash = "f".repeat(64);

      // Create pack in store
      await createFakePackStore(packsDir, packId, hash);

      // Create registry
      const registry = createRegistry([
        {
          id: packId,
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Remove pack
      await handlePackRemove({ packId }, deps);

      // The parent directory (packsDir/packId) should also be gone
      const packIdDir = path.join(packsDir, packId);
      expect(await directoryExists(packIdDir)).toBe(false);
    });
  });

  // ===========================================================================
  // formatPackRemoveSuccess()
  // ===========================================================================

  describe("formatPackRemoveSuccess()", () => {
    it("formats removal success message", () => {
      const result: PackRemoveResult = {
        packId: "my-pack",
        version: "1.0.0",
        hash: "a".repeat(64),
        removedPath: "/store/packs/my-pack/" + "a".repeat(64),
        status: "removed",
      };

      const lines = formatPackRemoveSuccess(result);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes("my-pack"))).toBe(true);
      expect(lines.some((l) => l.includes("Removed"))).toBe(true);
    });

    it("includes version and path in output", () => {
      const result: PackRemoveResult = {
        packId: "test-pack",
        version: "2.3.4",
        hash: "b".repeat(64),
        removedPath: "/some/path/test-pack/" + "b".repeat(64),
        status: "removed",
      };

      const lines = formatPackRemoveSuccess(result);

      expect(lines.some((l) => l.includes("2.3.4"))).toBe(true);
    });
  });

  // ===========================================================================
  // Integration-style tests
  // ===========================================================================

  describe("integration", () => {
    it("full flow: add pack via RegistryService, remove via handler", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const packId = "integration-pack";
      const hash = "f".repeat(64);

      // Create pack in store
      const packDir = await createFakePackStore(packsDir, packId, hash);

      // Register via RegistryService (simulates pack add)
      const registryService = new RegistryService(registryFile);
      await registryService.registerPack({
        id: packId,
        version: "1.0.0",
        origin: { type: "local", localPath: "/test/path" },
        hash,
      });

      // Verify pack exists
      expect(await registryService.getPack(packId)).toBeDefined();
      expect(await directoryExists(packDir)).toBe(true);

      // Remove via handler
      const result = await handlePackRemove({ packId }, deps);

      // Verify removal
      expect(result.status).toBe("removed");
      expect(await registryService.getPack(packId)).toBeUndefined();
      expect(await directoryExists(packDir)).toBe(false);
    });
  });
});
