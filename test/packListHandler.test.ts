import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackList,
  formatPackListOutput,
  formatOrigin,
  type PackListDependencies,
  type PackListResult,
} from "../src/cli/handlers/packListHandler.js";
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
 * Creates test dependencies with isolated registry.
 */
async function createTestDependencies(): Promise<{
  storeDir: string;
  deps: PackListDependencies;
  registryFile: string;
}> {
  const storeDir = await createTestDir("list-test");
  const registryFile = path.join(storeDir, "registry.json");

  const deps: PackListDependencies = {
    registryFile,
  };

  return { storeDir, deps, registryFile };
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

// =============================================================================
// Tests
// =============================================================================

describe("packListHandler", () => {
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
  // handlePackList() - Empty Registry
  // ===========================================================================

  describe("handlePackList() - empty registry", () => {
    it("returns empty list when registry file does not exist", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handlePackList(deps);

      expect(result.packs).toHaveLength(0);
      expect(result.registryExists).toBe(false);
    });

    it("returns empty list when registry has no packs", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Write empty registry
      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      const result = await handlePackList(deps);

      expect(result.packs).toHaveLength(0);
    });
  });

  // ===========================================================================
  // handlePackList() - With Packs
  // ===========================================================================

  describe("handlePackList() - with packs", () => {
    it("returns correct pack list", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([
        {
          id: "my-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path/to/pack" },
        },
      ]);
      await writeRegistry(registryFile, registry);

      const result = await handlePackList(deps);

      expect(result.packs).toHaveLength(1);
      expect(result.packs[0].packId).toBe("my-pack");
      expect(result.packs[0].version).toBe("1.0.0");
      expect(result.packs[0].origin).toBe("local:/path/to/pack");
      expect(result.registryExists).toBe(true);
    });

    it("returns multiple packs", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([
        {
          id: "pack-a",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path/a" },
        },
        {
          id: "pack-b",
          version: "2.0.0",
          origin: { type: "local", localPath: "/path/b" },
        },
        {
          id: "pack-c",
          version: "3.0.0",
          origin: { type: "local", localPath: "/path/c" },
        },
      ]);
      await writeRegistry(registryFile, registry);

      const result = await handlePackList(deps);

      expect(result.packs).toHaveLength(3);
    });

    it("sorts packs by packId ascending", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Create packs in non-alphabetical order
      const registry = createRegistry([
        {
          id: "zebra-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/z" },
        },
        {
          id: "alpha-pack",
          version: "2.0.0",
          origin: { type: "local", localPath: "/a" },
        },
        {
          id: "middle-pack",
          version: "3.0.0",
          origin: { type: "local", localPath: "/m" },
        },
      ]);
      await writeRegistry(registryFile, registry);

      const result = await handlePackList(deps);

      expect(result.packs[0].packId).toBe("alpha-pack");
      expect(result.packs[1].packId).toBe("middle-pack");
      expect(result.packs[2].packId).toBe("zebra-pack");
    });

    it("includes installedAt timestamp", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const installedAt = "2024-06-15T14:30:00.000Z";
      const registry = createRegistry([
        {
          id: "timed-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          installedAt,
        },
      ]);
      await writeRegistry(registryFile, registry);

      const result = await handlePackList(deps);

      expect(result.packs[0].installedAt).toBe(installedAt);
    });
  });

  // ===========================================================================
  // handlePackList() - Invalid Registry
  // ===========================================================================

  describe("handlePackList() - invalid registry", () => {
    it("throws actionable error for invalid JSON", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Write invalid JSON
      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(registryFile, "{ invalid json }");

      await expect(handlePackList(deps)).rejects.toMatchObject({
        code: "REGISTRY_INVALID_JSON",
      });
    });

    it("error includes registry file path for invalid JSON", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(registryFile, "not valid json");

      try {
        await handlePackList(deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.path).toBe(registryFile);
        expect(err.hint).toBeTruthy();
      }
    });

    it("throws actionable error for schema mismatch", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Write valid JSON but invalid schema
      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(
        registryFile,
        JSON.stringify({
          schemaVersion: "not a number",
          packs: {},
        })
      );

      await expect(handlePackList(deps)).rejects.toMatchObject({
        code: "REGISTRY_INVALID_SCHEMA",
      });
    });

    it("error includes registry file path for schema error", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(
        registryFile,
        JSON.stringify({
          // Missing schemaVersion
          packs: {},
        })
      );

      try {
        await handlePackList(deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.path).toBe(registryFile);
      }
    });
  });

  // ===========================================================================
  // formatOrigin()
  // ===========================================================================

  describe("formatOrigin()", () => {
    it("formats local origin", () => {
      const origin: PackOrigin = {
        type: "local",
        localPath: "/home/user/my-pack",
      };

      expect(formatOrigin(origin)).toBe("local:/home/user/my-pack");
    });

    it("formats git origin with ref", () => {
      const origin: PackOrigin = {
        type: "git",
        gitUrl: "https://github.com/org/repo",
        ref: "main",
      };

      expect(formatOrigin(origin)).toBe("git:https://github.com/org/repo#main");
    });

    it("formats git origin with commit (short SHA)", () => {
      const origin: PackOrigin = {
        type: "git",
        gitUrl: "https://github.com/org/repo",
        commit: "abc123def456789",
      };

      expect(formatOrigin(origin)).toBe("git:https://github.com/org/repo@abc123d");
    });

    it("formats git origin without ref or commit", () => {
      const origin: PackOrigin = {
        type: "git",
        gitUrl: "https://github.com/org/repo",
      };

      expect(formatOrigin(origin)).toBe("git:https://github.com/org/repo");
    });

    it("formats zip origin", () => {
      const origin: PackOrigin = {
        type: "zip",
        zipUrl: "https://example.com/pack.zip",
      };

      expect(formatOrigin(origin)).toBe("zip:https://example.com/pack.zip");
    });

    it("formats npm origin", () => {
      const origin: PackOrigin = {
        type: "npm",
        packageName: "@org/my-pack",
      };

      expect(formatOrigin(origin)).toBe("npm:@org/my-pack");
    });

    it("formats npm origin with custom registry", () => {
      const origin: PackOrigin = {
        type: "npm",
        packageName: "private-pack",
        registry: "https://npm.mycompany.com",
      };

      expect(formatOrigin(origin)).toBe("npm:private-pack (https://npm.mycompany.com)");
    });
  });

  // ===========================================================================
  // formatPackListOutput()
  // ===========================================================================

  describe("formatPackListOutput()", () => {
    it("formats empty list with helpful message", () => {
      const result: PackListResult = {
        packs: [],
        registryExists: false,
      };

      const lines = formatPackListOutput(result);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("No packs installed");
      expect(lines[0]).toContain("scaffoldix pack add");
    });

    it("formats single pack with header", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "my-pack",
            version: "1.0.0",
            origin: "local:/path",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const lines = formatPackListOutput(result);

      // Should have header, separator, and one pack
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toContain("PACK");
      expect(lines[0]).toContain("VERSION");
      expect(lines[0]).toContain("ORIGIN");
      expect(lines[1]).toMatch(/^-+$/); // Separator line
      expect(lines[2]).toContain("my-pack");
      expect(lines[2]).toContain("1.0.0");
      expect(lines[2]).toContain("local:/path");
    });

    it("formats multiple packs with aligned columns", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "short",
            version: "1.0.0",
            origin: "local:/a",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
          {
            packId: "longer-pack-name",
            version: "10.20.30",
            origin: "local:/longer/path/here",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const lines = formatPackListOutput(result);

      // Verify alignment (second column should start at same position)
      const versionPosLine3 = lines[2].indexOf("1.0.0");
      const versionPosLine4 = lines[3].indexOf("10.20.30");

      // Columns should be aligned (allow for padding)
      expect(Math.abs(versionPosLine3 - versionPosLine4)).toBeLessThanOrEqual(1);
    });

    it("output is stable and predictable", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "alpha",
            version: "1.0.0",
            origin: "local:/a",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
          {
            packId: "beta",
            version: "2.0.0",
            origin: "local:/b",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      // Call twice and verify output is identical
      const lines1 = formatPackListOutput(result);
      const lines2 = formatPackListOutput(result);

      expect(lines1).toEqual(lines2);
    });
  });

  // ===========================================================================
  // Integration-style tests
  // ===========================================================================

  describe("integration", () => {
    it("full flow: write registry, list packs, verify output", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Use RegistryService to write (simulates pack add)
      const registryService = new RegistryService(registryFile);
      await registryService.registerPack({
        id: "test-pack",
        version: "1.0.0",
        origin: { type: "local", localPath: "/test/path" },
        hash: "a".repeat(64),
      });

      // List packs
      const result = await handlePackList(deps);

      expect(result.packs).toHaveLength(1);
      expect(result.packs[0].packId).toBe("test-pack");

      // Format and verify output
      const lines = formatPackListOutput(result);
      expect(lines.some((l) => l.includes("test-pack"))).toBe(true);
      expect(lines.some((l) => l.includes("1.0.0"))).toBe(true);
      expect(lines.some((l) => l.includes("local:/test/path"))).toBe(true);
    });
  });
});
