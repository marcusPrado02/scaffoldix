import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackAdd,
  formatPackAddSuccess,
  type PackAddDependencies,
  type PackAddResult,
} from "../src/cli/handlers/packAddHandler.js";
import { RegistryService } from "../src/core/registry/RegistryService.js";
import { type StoreLogger } from "../src/core/store/StoreService.js";

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
 * Creates a minimal valid pack manifest YAML.
 */
function createManifestYaml(name: string, version: string): string {
  const quotedName = name.startsWith("@") || name.includes(":") ? `"${name}"` : name;
  return `pack:
  name: ${quotedName}
  version: ${version}
archetypes:
  - id: default
    templateRoot: templates/default
`;
}

/**
 * Creates a test pack directory with manifest and template files.
 */
async function createTestPack(
  baseDir: string,
  name: string,
  version: string,
  additionalFiles?: Record<string, string>,
): Promise<string> {
  const packDir = path.join(baseDir, name.replace("/", "__"));
  await fs.mkdir(packDir, { recursive: true });

  // Create manifest
  await fs.writeFile(path.join(packDir, "archetype.yaml"), createManifestYaml(name, version));

  // Create template directory structure
  const templateDir = path.join(packDir, "templates", "default");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, "README.md"), `# ${name}\n`);

  // Add additional files if provided
  if (additionalFiles) {
    for (const [relativePath, content] of Object.entries(additionalFiles)) {
      const filePath = path.join(packDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }

  return packDir;
}

/**
 * Creates test dependencies with isolated store directories.
 */
async function createTestDependencies(): Promise<{
  storeDir: string;
  deps: PackAddDependencies;
  loggerSpy: StoreLogger;
}> {
  const storeDir = await createTestDir("store-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  await fs.mkdir(packsDir, { recursive: true });

  const loggerSpy: StoreLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };

  const deps: PackAddDependencies = {
    storeConfig: {
      storeDir,
      packsDir,
      registryFile,
    },
    logger: loggerSpy,
  };

  return { storeDir, deps, loggerSpy };
}

// =============================================================================
// Tests
// =============================================================================

describe("packAddHandler", () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTestDir(dir);
    }
    testDirs.length = 0;
    vi.clearAllMocks();
  });

  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  // ===========================================================================
  // handlePackAdd() - Successful Installation
  // ===========================================================================

  describe("handlePackAdd() - successful installation", () => {
    it("installs a valid pack from absolute path", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "test-pack", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      expect(result.packId).toBe("test-pack");
      expect(result.version).toBe("1.0.0");
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.status).toBe("installed");
      expect(result.sourcePath).toBe(packDir);
    });

    it("installs a valid pack from relative path", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "relative-test", "2.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Use relative path from sourceDir
      const relativePath = path.relative(sourceDir, packDir);

      const result = await handlePackAdd({ packPath: relativePath, cwd: sourceDir }, deps);

      expect(result.packId).toBe("relative-test");
      expect(result.version).toBe("2.0.0");
      expect(result.status).toBe("installed");
      // sourcePath should be resolved to absolute
      expect(path.isAbsolute(result.sourcePath)).toBe(true);
    });

    it("creates registry entry on successful install", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "registry-check", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      // Check registry directly
      const registry = new RegistryService(deps.storeConfig.registryFile);
      const entry = await registry.getPack("registry-check");

      expect(entry).toBeDefined();
      expect(entry!.id).toBe("registry-check");
      expect(entry!.version).toBe("1.0.0");
      expect(entry!.hash).toBe(result.hash);
      expect(entry!.origin).toEqual({ type: "local", localPath: packDir });
    });

    it("copies pack files to store", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "copy-check", "1.0.0", {
        "src/index.ts": "export const name = 'test';",
      });
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      // Check files exist in destDir
      const manifestExists = await fs
        .access(path.join(result.destDir, "archetype.yaml"))
        .then(() => true)
        .catch(() => false);
      const srcExists = await fs
        .access(path.join(result.destDir, "src/index.ts"))
        .then(() => true)
        .catch(() => false);

      expect(manifestExists).toBe(true);
      expect(srcExists).toBe(true);
    });
  });

  // ===========================================================================
  // handlePackAdd() - Idempotency
  // ===========================================================================

  describe("handlePackAdd() - idempotency", () => {
    it("returns 'already_installed' on duplicate install", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "idempotent-pack", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // First install
      const result1 = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      // Second install
      const result2 = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      expect(result1.status).toBe("installed");
      expect(result2.status).toBe("already_installed");
      expect(result2.destDir).toBe(result1.destDir);
      expect(result2.hash).toBe(result1.hash);
    });

    it("registry contains single entry after multiple installs", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "single-entry", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Install three times
      await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);
      await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);
      await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);

      // Check registry
      const registry = new RegistryService(deps.storeConfig.registryFile);
      const packs = await registry.listPacks();

      expect(packs).toHaveLength(1);
    });

    it("same destDir returned on repeated installs", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "same-dest", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const results: PackAddResult[] = [];
      for (let i = 0; i < 3; i++) {
        const result = await handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps);
        results.push(result);
      }

      // All destDirs should be identical
      expect(results[1].destDir).toBe(results[0].destDir);
      expect(results[2].destDir).toBe(results[0].destDir);
    });
  });

  // ===========================================================================
  // handlePackAdd() - Path Validation Errors
  // ===========================================================================

  describe("handlePackAdd() - path validation errors", () => {
    it("fails with clear error when path does not exist", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await expect(
        handlePackAdd({ packPath: "/nonexistent/pack/path", cwd: "/tmp" }, deps),
      ).rejects.toMatchObject({
        code: "PACK_PATH_NOT_FOUND",
        message: expect.stringContaining("not found"),
      });
    });

    it("error includes both provided and resolved paths", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      try {
        await handlePackAdd({ packPath: "./missing-pack", cwd: "/some/cwd" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("PACK_PATH_NOT_FOUND");
        expect(err.details.providedPath).toBe("./missing-pack");
        expect(err.details.resolvedPath).toContain("missing-pack");
      }
    });

    it("fails when path is a file instead of directory", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const filePath = path.join(sourceDir, "not-a-dir.txt");
      await fs.writeFile(filePath, "just a file");

      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await expect(handlePackAdd({ packPath: filePath, cwd: "/tmp" }, deps)).rejects.toMatchObject({
        code: "PACK_NOT_DIRECTORY",
        message: expect.stringContaining("directory"),
      });
    });

    it("suggests using parent directory when path is a file", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const filePath = path.join(sourceDir, "manifest.yaml");
      await fs.writeFile(filePath, "some content");

      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      try {
        await handlePackAdd({ packPath: filePath, cwd: "/tmp" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("file");
        expect(err.hint).toContain("directory");
      }
    });
  });

  // ===========================================================================
  // handlePackAdd() - Manifest Errors
  // ===========================================================================

  describe("handlePackAdd() - manifest errors", () => {
    it("fails with clear error when manifest is missing", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const emptyDir = path.join(sourceDir, "empty-pack");
      await fs.mkdir(emptyDir);

      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await expect(handlePackAdd({ packPath: emptyDir, cwd: "/tmp" }, deps)).rejects.toMatchObject({
        code: "MANIFEST_NOT_FOUND",
      });
    });

    it("manifest error includes expected filenames", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const emptyDir = path.join(sourceDir, "no-manifest");
      await fs.mkdir(emptyDir);

      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      try {
        await handlePackAdd({ packPath: emptyDir, cwd: "/tmp" }, deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint || err.message).toMatch(/archetype\.yaml|pack\.yaml/);
      }
    });

    it("fails with schema error for invalid manifest", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = path.join(sourceDir, "invalid-manifest");
      await fs.mkdir(packDir);
      // Create invalid manifest (missing required fields)
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        "pack:\n  name: test\n# missing version and archetypes",
      );

      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      await expect(handlePackAdd({ packPath: packDir, cwd: "/tmp" }, deps)).rejects.toMatchObject({
        code: "MANIFEST_SCHEMA_ERROR",
      });
    });
  });

  // ===========================================================================
  // formatPackAddSuccess()
  // ===========================================================================

  describe("formatPackAddSuccess()", () => {
    it("formats 'installed' status correctly", () => {
      const result: PackAddResult = {
        packId: "my-pack",
        version: "1.0.0",
        hash: "a".repeat(64),
        destDir: "/store/packs/my-pack/" + "a".repeat(64),
        sourcePath: "/source/my-pack",
        status: "installed",
      };

      const lines = formatPackAddSuccess(result);

      expect(lines[0]).toContain("Installed pack my-pack@1.0.0");
      expect(lines.some((l) => l.includes("From:"))).toBe(true);
      expect(lines.some((l) => l.includes("To:"))).toBe(true);
      expect(lines.some((l) => l.includes("Hash:"))).toBe(true);
    });

    it("formats 'already_installed' status correctly", () => {
      const result: PackAddResult = {
        packId: "existing-pack",
        version: "2.0.0",
        hash: "b".repeat(64),
        destDir: "/store/packs/existing-pack/" + "b".repeat(64),
        sourcePath: "/source/existing-pack",
        status: "already_installed",
      };

      const lines = formatPackAddSuccess(result);

      expect(lines[0]).toContain("already installed");
      expect(lines.some((l) => l.includes("Pack:"))).toBe(true);
      expect(lines.some((l) => l.includes("Location:"))).toBe(true);
    });
  });

  // ===========================================================================
  // Path Resolution
  // ===========================================================================

  describe("path resolution", () => {
    it("normalizes paths with extra slashes", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "normalize-test", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Path with extra slashes
      const messyPath = packDir + "///";

      const result = await handlePackAdd({ packPath: messyPath, cwd: "/tmp" }, deps);

      expect(result.status).toBe("installed");
      expect(result.sourcePath).not.toContain("///");
    });

    it("resolves .. in paths correctly", async () => {
      const sourceDir = trackDir(await createTestDir("source"));
      const packDir = await createTestPack(sourceDir, "parent-ref", "1.0.0");
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      // Create a nested cwd and use .. to reach the pack
      const nestedCwd = path.join(sourceDir, "nested", "deep");
      await fs.mkdir(nestedCwd, { recursive: true });
      const relativePath = "../../parent-ref";

      const result = await handlePackAdd({ packPath: relativePath, cwd: nestedCwd }, deps);

      expect(result.packId).toBe("parent-ref");
      expect(result.status).toBe("installed");
    });
  });
});
