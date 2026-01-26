import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackInfo,
  formatPackInfoOutput,
  type PackInfoDependencies,
  type PackInfoResult,
} from "../src/cli/handlers/packInfoHandler.js";
import {
  RegistryService,
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";

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
 * Creates test dependencies with isolated store.
 */
async function createTestDependencies(): Promise<{
  storeDir: string;
  packsDir: string;
  deps: PackInfoDependencies;
  registryFile: string;
}> {
  const storeDir = await createTestDir("info-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  await fs.mkdir(packsDir, { recursive: true });

  const deps: PackInfoDependencies = {
    registryFile,
    packsDir,
  };

  return { storeDir, packsDir, deps, registryFile };
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
  }>
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
 * Sanitizes pack ID for filesystem (matches handler logic).
 */
function sanitizePackId(packId: string): string {
  return packId
    .replace(/\//g, "__") // Replace / with __ (scoped packages)
    .replace(/[<>:"|?*]/g, "_"); // Replace Windows-unsafe chars
}

/**
 * Creates a pack directory in the store with a valid manifest.
 */
async function createPackInStore(
  packsDir: string,
  packId: string,
  hash: string,
  archetypes: string[]
): Promise<string> {
  const sanitizedId = sanitizePackId(packId);
  const packDir = path.join(packsDir, sanitizedId, hash);
  await fs.mkdir(packDir, { recursive: true });

  // Create pack.yaml manifest with v0.1 schema format
  const archetypesList = archetypes
    .map(
      (id) => `  - id: ${id}
    templateRoot: templates/${id}`
    )
    .join("\n");

  // Quote pack name if it starts with @ to avoid YAML issues
  const quotedName = packId.startsWith("@") || packId.includes(":") ? `"${packId}"` : packId;

  const manifest = `pack:
  name: ${quotedName}
  version: "1.0.0"
archetypes:
${archetypesList}
`;

  await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

  return packDir;
}

// =============================================================================
// Tests
// =============================================================================

describe("packInfoHandler", () => {
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
  // handlePackInfo() - Pack Not Found
  // ===========================================================================

  describe("handlePackInfo() - pack not found", () => {
    it("throws PACK_NOT_FOUND when registry does not exist", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await expect(handlePackInfo({ packId: "nonexistent-pack" }, deps)).rejects.toMatchObject({
        code: "PACK_NOT_FOUND",
      });
    });

    it("throws PACK_NOT_FOUND when pack is not in registry", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Write registry with different pack
      const registry = createRegistry([
        {
          id: "other-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
        },
      ]);
      await writeRegistry(registryFile, registry);

      await expect(handlePackInfo({ packId: "nonexistent-pack" }, deps)).rejects.toMatchObject({
        code: "PACK_NOT_FOUND",
      });
    });

    it("error message includes pack ID", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      try {
        await handlePackInfo({ packId: "my-missing-pack" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("my-missing-pack");
      }
    });

    it("error includes helpful hint with pack list command", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      try {
        await handlePackInfo({ packId: "nonexistent" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("pack list");
      }
    });
  });

  // ===========================================================================
  // handlePackInfo() - Store Path Missing
  // ===========================================================================

  describe("handlePackInfo() - store path missing", () => {
    it("throws PACK_STORE_MISSING when pack directory does not exist", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "b".repeat(64);
      const registry = createRegistry([
        {
          id: "missing-files-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/original/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Don't create the pack directory

      await expect(handlePackInfo({ packId: "missing-files-pack" }, deps)).rejects.toMatchObject({
        code: "PACK_STORE_MISSING",
      });
    });

    it("error includes store path for missing directory", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "c".repeat(64);
      const registry = createRegistry([
        {
          id: "orphan-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      try {
        await handlePackInfo({ packId: "orphan-pack" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.storePath).toContain(packsDir);
        expect(err.details.storePath).toContain("orphan-pack");
        expect(err.details.storePath).toContain(hash);
      }
    });

    it("error hint suggests reinstalling pack", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([
        {
          id: "corrupt-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash: "d".repeat(64),
        },
      ]);
      await writeRegistry(registryFile, registry);

      try {
        await handlePackInfo({ packId: "corrupt-pack" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("pack add");
      }
    });
  });

  // ===========================================================================
  // handlePackInfo() - Manifest Errors
  // ===========================================================================

  describe("handlePackInfo() - manifest errors", () => {
    it("throws PACK_MANIFEST_CORRUPT when manifest is missing", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "e".repeat(64);
      const registry = createRegistry([
        {
          id: "no-manifest-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack directory but no manifest
      const packDir = path.join(packsDir, "no-manifest-pack", hash);
      await fs.mkdir(packDir, { recursive: true });

      await expect(handlePackInfo({ packId: "no-manifest-pack" }, deps)).rejects.toMatchObject({
        code: "PACK_MANIFEST_CORRUPT",
      });
    });

    it("throws PACK_MANIFEST_CORRUPT when manifest is invalid YAML", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "f".repeat(64);
      const registry = createRegistry([
        {
          id: "bad-yaml-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack directory with invalid manifest
      const packDir = path.join(packsDir, "bad-yaml-pack", hash);
      await fs.mkdir(packDir, { recursive: true });
      await fs.writeFile(path.join(packDir, "pack.yaml"), "{ invalid: yaml: content }");

      await expect(handlePackInfo({ packId: "bad-yaml-pack" }, deps)).rejects.toMatchObject({
        code: "PACK_MANIFEST_CORRUPT",
      });
    });

    it("error includes store path for manifest errors", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "0".repeat(64);
      const registry = createRegistry([
        {
          id: "corrupt-manifest",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack directory without manifest
      const packDir = path.join(packsDir, "corrupt-manifest", hash);
      await fs.mkdir(packDir, { recursive: true });

      try {
        await handlePackInfo({ packId: "corrupt-manifest" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.storePath).toContain(packDir);
      }
    });
  });

  // ===========================================================================
  // handlePackInfo() - Success Cases
  // ===========================================================================

  describe("handlePackInfo() - success", () => {
    it("returns all pack fields", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "1".repeat(64);
      const installedAt = "2024-06-15T14:30:00.000Z";
      const registry = createRegistry([
        {
          id: "complete-pack",
          version: "2.5.0",
          origin: { type: "local", localPath: "/source/path" },
          hash,
          installedAt,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "complete-pack", hash, ["basic", "advanced"]);

      const result = await handlePackInfo({ packId: "complete-pack" }, deps);

      expect(result.packId).toBe("complete-pack");
      expect(result.version).toBe("2.5.0");
      expect(result.origin).toBe("local:/source/path");
      expect(result.hash).toBe(hash);
      expect(result.installedAt).toBe(installedAt);
      expect(result.storePath).toContain(packsDir);
      expect(result.storePath).toContain("complete-pack");
    });

    it("returns sorted archetypes list", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "2".repeat(64);
      const registry = createRegistry([
        {
          id: "multi-arch-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create archetypes in non-alphabetical order
      await createPackInStore(packsDir, "multi-arch-pack", hash, [
        "zebra-archetype",
        "alpha-archetype",
        "middle-archetype",
      ]);

      const result = await handlePackInfo({ packId: "multi-arch-pack" }, deps);

      expect(result.archetypes).toEqual([
        "alpha-archetype",
        "middle-archetype",
        "zebra-archetype",
      ]);
    });

    it("handles single archetype", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "3".repeat(64);
      const registry = createRegistry([
        {
          id: "single-archetype",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "single-archetype", hash, ["only-one"]);

      const result = await handlePackInfo({ packId: "single-archetype" }, deps);

      expect(result.archetypes).toEqual(["only-one"]);
    });

    it("handles scoped package names", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "4".repeat(64);
      const registry = createRegistry([
        {
          id: "@myorg/scoped-pack",
          version: "1.0.0",
          origin: { type: "npm", packageName: "@myorg/scoped-pack" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "@myorg/scoped-pack", hash, ["web"]);

      const result = await handlePackInfo({ packId: "@myorg/scoped-pack" }, deps);

      expect(result.packId).toBe("@myorg/scoped-pack");
      expect(result.origin).toBe("npm:@myorg/scoped-pack");
      // Store path should use sanitized ID
      expect(result.storePath).toContain("@myorg__scoped-pack");
    });

    it("includes raw origin object", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "5".repeat(64);
      const gitOrigin: PackOrigin = {
        type: "git",
        gitUrl: "https://github.com/org/repo",
        ref: "v1.0.0",
      };
      const registry = createRegistry([
        {
          id: "git-pack",
          version: "1.0.0",
          origin: gitOrigin,
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "git-pack", hash, ["default"]);

      const result = await handlePackInfo({ packId: "git-pack" }, deps);

      expect(result.originRaw).toEqual(gitOrigin);
      expect(result.origin).toBe("git:https://github.com/org/repo#v1.0.0");
    });
  });

  // ===========================================================================
  // formatPackInfoOutput()
  // ===========================================================================

  describe("formatPackInfoOutput()", () => {
    it("formats all fields correctly", () => {
      const result: PackInfoResult = {
        packId: "my-pack",
        version: "1.2.3",
        origin: "local:/home/user/pack",
        originRaw: { type: "local", localPath: "/home/user/pack" },
        storePath: "/home/user/.local/share/scaffoldix/packs/my-pack/abc123",
        installedAt: "2024-06-15T14:30:00.000Z",
        hash: "abc123def456",
        archetypes: ["api", "web"],
      };

      const lines = formatPackInfoOutput(result);

      expect(lines).toContain("Pack: my-pack");
      expect(lines).toContain("Version: 1.2.3");
      expect(lines).toContain("Origin: local:/home/user/pack");
      expect(lines).toContain("Store path: /home/user/.local/share/scaffoldix/packs/my-pack/abc123");
      expect(lines).toContain("Installed at: 2024-06-15T14:30:00.000Z");
      expect(lines).toContain("Hash: abc123def456");
      expect(lines).toContain("Archetypes:");
      expect(lines).toContain("  - api");
      expect(lines).toContain("  - web");
    });

    it("formats single archetype", () => {
      const result: PackInfoResult = {
        packId: "single-pack",
        version: "1.0.0",
        origin: "local:/path",
        originRaw: { type: "local", localPath: "/path" },
        storePath: "/store/single-pack/hash",
        installedAt: "2024-01-01T00:00:00.000Z",
        hash: "hash123",
        archetypes: ["default"],
      };

      const lines = formatPackInfoOutput(result);

      expect(lines).toContain("Archetypes:");
      expect(lines).toContain("  - default");
      // Exactly one archetype item
      const archetypesIndex = lines.indexOf("Archetypes:");
      expect(lines.slice(archetypesIndex + 1).filter((l) => l.startsWith("  -"))).toHaveLength(1);
    });

    it("includes empty line before Archetypes section", () => {
      const result: PackInfoResult = {
        packId: "test",
        version: "1.0.0",
        origin: "local:/path",
        originRaw: { type: "local", localPath: "/path" },
        storePath: "/store",
        installedAt: "2024-01-01T00:00:00.000Z",
        hash: "hash",
        archetypes: ["one"],
      };

      const lines = formatPackInfoOutput(result);
      const archetypesIndex = lines.indexOf("Archetypes:");

      // Should have empty line before Archetypes
      expect(lines[archetypesIndex - 1]).toBe("");
    });

    it("output is stable and predictable", () => {
      const result: PackInfoResult = {
        packId: "stable-pack",
        version: "1.0.0",
        origin: "local:/path",
        originRaw: { type: "local", localPath: "/path" },
        storePath: "/store/path",
        installedAt: "2024-01-01T00:00:00.000Z",
        hash: "stablehash",
        archetypes: ["a", "b", "c"],
      };

      const lines1 = formatPackInfoOutput(result);
      const lines2 = formatPackInfoOutput(result);

      expect(lines1).toEqual(lines2);
    });
  });

  // ===========================================================================
  // Integration-style tests
  // ===========================================================================

  describe("integration", () => {
    it("full flow: register pack, create store, get info", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "abcdef" + "0".repeat(58);

      // Use RegistryService to register pack
      const registryService = new RegistryService(registryFile);
      await registryService.registerPack({
        id: "integration-pack",
        version: "3.0.0",
        origin: { type: "local", localPath: "/integration/source" },
        hash,
      });

      // Create pack in store with archetypes
      await createPackInStore(packsDir, "integration-pack", hash, [
        "backend",
        "frontend",
        "shared",
      ]);

      // Get pack info
      const result = await handlePackInfo({ packId: "integration-pack" }, deps);

      expect(result.packId).toBe("integration-pack");
      expect(result.version).toBe("3.0.0");
      expect(result.origin).toBe("local:/integration/source");
      expect(result.archetypes).toEqual(["backend", "frontend", "shared"]);

      // Format and verify output
      const lines = formatPackInfoOutput(result);
      expect(lines.some((l) => l.includes("integration-pack"))).toBe(true);
      expect(lines.some((l) => l.includes("3.0.0"))).toBe(true);
      expect(lines.some((l) => l.includes("backend"))).toBe(true);
      expect(lines.some((l) => l.includes("frontend"))).toBe(true);
    });
  });
});
