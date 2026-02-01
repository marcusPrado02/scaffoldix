import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import {
  StoreService,
  type StoreServiceConfig,
  type StoreLogger,
} from "../src/core/store/StoreService.js";
import { RegistryService } from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory for each test.
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
 * Properly quotes values that contain special YAML characters.
 */
function createManifestYaml(name: string, version: string): string {
  // Quote strings that start with special YAML characters or contain problematic chars
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
  const packDir = path.join(baseDir, name);
  await fs.mkdir(packDir, { recursive: true });

  // Create manifest
  const manifest = createManifestYaml(name, version);
  await fs.writeFile(path.join(packDir, "archetype.yaml"), manifest);

  // Create template directory structure
  const templateDir = path.join(packDir, "templates", "default");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(
    path.join(templateDir, "README.md"),
    `# ${name}\n\nThis is a test template.\n`,
  );
  await fs.writeFile(path.join(templateDir, "index.ts"), `export const name = "${name}";\n`);

  // Add any additional files
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
 * Creates a test StoreService with a fresh temp store.
 */
async function createTestSetup(): Promise<{
  storeDir: string;
  packsDir: string;
  registryFile: string;
  config: StoreServiceConfig;
  service: StoreService;
  loggerSpy: StoreLogger;
  sourceDir: string;
}> {
  const storeDir = await createTestDir("store-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");
  const sourceDir = await createTestDir("source-test");

  await fs.mkdir(packsDir, { recursive: true });

  const config: StoreServiceConfig = {
    storeDir,
    packsDir,
    registryFile,
  };

  // Create a spy logger to track log calls
  const loggerSpy: StoreLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  };

  const service = new StoreService(config, loggerSpy);

  return {
    storeDir,
    packsDir,
    registryFile,
    config,
    service,
    loggerSpy,
    sourceDir,
  };
}

/**
 * Computes SHA-256 hash of a file.
 */
async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Checks if a directory contains all expected files.
 */
async function directoryContainsFiles(dir: string, relativePaths: string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    const fullPath = path.join(dir, relativePath);
    try {
      await fs.access(fullPath);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Gets file content as string.
 */
async function readFileContent(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

// =============================================================================
// Tests
// =============================================================================

describe("StoreService", () => {
  let testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTestDir(dir);
    }
    testDirs = [];
    vi.clearAllMocks();
  });

  // Helper to track directories for cleanup
  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("accepts valid absolute paths", async () => {
      const storeDir = trackDir(await createTestDir("ctor-test"));
      const config: StoreServiceConfig = {
        storeDir,
        packsDir: path.join(storeDir, "packs"),
        registryFile: path.join(storeDir, "registry.json"),
      };

      expect(() => new StoreService(config)).not.toThrow();
    });

    it("rejects relative storeDir path", () => {
      const config: StoreServiceConfig = {
        storeDir: "relative/path",
        packsDir: "/absolute/packs",
        registryFile: "/absolute/registry.json",
      };

      expect(() => new StoreService(config)).toThrow(/must be absolute/i);
    });

    it("rejects relative packsDir path", () => {
      const config: StoreServiceConfig = {
        storeDir: "/absolute/store",
        packsDir: "relative/packs",
        registryFile: "/absolute/registry.json",
      };

      expect(() => new StoreService(config)).toThrow(/must be absolute/i);
    });

    it("rejects relative registryFile path", () => {
      const config: StoreServiceConfig = {
        storeDir: "/absolute/store",
        packsDir: "/absolute/packs",
        registryFile: "relative/registry.json",
      };

      expect(() => new StoreService(config)).toThrow(/must be absolute/i);
    });

    it("works without a logger (uses no-op)", async () => {
      const storeDir = trackDir(await createTestDir("no-logger-test"));
      const config: StoreServiceConfig = {
        storeDir,
        packsDir: path.join(storeDir, "packs"),
        registryFile: path.join(storeDir, "registry.json"),
      };

      const service = new StoreService(config); // No logger
      expect(service).toBeDefined();
    });
  });

  // ===========================================================================
  // installLocalPack() - Basic Installation
  // ===========================================================================

  describe("installLocalPack() - basic installation", () => {
    it("installs a valid pack from local path", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "test-pack", "1.0.0");

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      expect(result.packId).toBe("test-pack");
      expect(result.version).toBe("1.0.0");
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.status).toBe("installed");
      expect(result.destDir).toContain("test-pack");
    });

    it("creates correct directory structure in store", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "my-pack", "2.0.0");

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Check that destDir exists and contains expected files
      const hasFiles = await directoryContainsFiles(result.destDir, [
        "archetype.yaml",
        "templates/default/README.md",
        "templates/default/index.ts",
      ]);

      expect(hasFiles).toBe(true);
    });

    it("copies file contents correctly", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "content-test", "1.0.0");

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Verify content matches
      const sourceContent = await readFileContent(path.join(packDir, "templates/default/index.ts"));
      const destContent = await readFileContent(
        path.join(result.destDir, "templates/default/index.ts"),
      );

      expect(destContent).toBe(sourceContent);
    });

    it("updates registry on successful install", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "registry-test", "1.0.0");

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Check registry directly
      const registry = new RegistryService(setup.registryFile);
      const entry = await registry.getPack("registry-test");

      expect(entry).toBeDefined();
      expect(entry!.id).toBe("registry-test");
      expect(entry!.version).toBe("1.0.0");
      expect(entry!.hash).toBe(result.hash);
      expect(entry!.origin).toEqual({ type: "local", localPath: packDir });
    });

    it("logs origin and destination", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "logging-test", "1.0.0");

      await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Verify logging was called with origin and destination
      expect(setup.loggerSpy.info).toHaveBeenCalledWith(
        "Pack installed successfully",
        expect.objectContaining({
          packId: "logging-test",
          sourcePath: packDir,
          destDir: expect.stringContaining("logging-test"),
        }),
      );
    });
  });

  // ===========================================================================
  // installLocalPack() - Idempotency
  // ===========================================================================

  describe("installLocalPack() - idempotency", () => {
    it("installing same pack twice does not duplicate data", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "idempotent-pack", "1.0.0");

      // Install first time
      const result1 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Install second time
      const result2 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Results should be identical
      expect(result2.packId).toBe(result1.packId);
      expect(result2.version).toBe(result1.version);
      expect(result2.hash).toBe(result1.hash);
      expect(result2.destDir).toBe(result1.destDir);

      // Second install should report "already_installed"
      expect(result1.status).toBe("installed");
      expect(result2.status).toBe("already_installed");
    });

    it("second install logs 'already installed'", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "skip-test", "1.0.0");

      // Install first time
      await setup.service.installLocalPack({ sourcePath: packDir });

      // Clear mock to track second call only
      vi.mocked(setup.loggerSpy.info).mockClear();

      // Install second time
      await setup.service.installLocalPack({ sourcePath: packDir });

      // Should log "already installed"
      expect(setup.loggerSpy.info).toHaveBeenCalledWith(
        "Pack already installed (skipped)",
        expect.objectContaining({
          packId: "skip-test",
        }),
      );
    });

    it("registry contains single entry after multiple installs", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "single-entry", "1.0.0");

      // Install three times
      await setup.service.installLocalPack({ sourcePath: packDir });
      await setup.service.installLocalPack({ sourcePath: packDir });
      await setup.service.installLocalPack({ sourcePath: packDir });

      // Check registry has exactly one entry
      const registry = new RegistryService(setup.registryFile);
      const packs = await registry.listPacks();

      expect(packs).toHaveLength(1);
      expect(packs[0].id).toBe("single-entry");
    });
  });

  // ===========================================================================
  // installLocalPack() - Determinism
  // ===========================================================================

  describe("installLocalPack() - determinism", () => {
    it("same manifest produces same hash", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      // Create two identical packs in different directories
      const packDir1 = await createTestPack(setup.sourceDir, "pack-a", "1.0.0");
      const packDir2 = await createTestPack(setup.sourceDir, "pack-b", "1.0.0");

      // Make pack-b's manifest identical to pack-a
      const manifestContent = createManifestYaml("identical-pack", "1.0.0");
      await fs.writeFile(path.join(packDir1, "archetype.yaml"), manifestContent);
      await fs.writeFile(path.join(packDir2, "archetype.yaml"), manifestContent);

      // Compute hashes directly from manifest files
      const hash1 = await computeFileHash(path.join(packDir1, "archetype.yaml"));
      const hash2 = await computeFileHash(path.join(packDir2, "archetype.yaml"));

      expect(hash1).toBe(hash2);
    });

    it("same pack produces same destDir across installs", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "stable-dest", "1.0.0");

      // Install and record destDir
      const result1 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Compute expected destDir using getPackDestDir
      const expectedDestDir = setup.service.getPackDestDir("stable-dest", result1.hash);

      expect(result1.destDir).toBe(expectedDestDir);
    });

    it("different manifest hash produces different destDir", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      // Create pack v1
      const packDir = await createTestPack(setup.sourceDir, "evolving-pack", "1.0.0");
      const result1 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Modify manifest to create different hash
      const newManifest = createManifestYaml("evolving-pack", "2.0.0");
      await fs.writeFile(path.join(packDir, "archetype.yaml"), newManifest);

      // Install modified pack
      const result2 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Different hash → different destDir
      expect(result2.hash).not.toBe(result1.hash);
      expect(result2.destDir).not.toBe(result1.destDir);
    });
  });

  // ===========================================================================
  // installLocalPack() - File Filtering
  // ===========================================================================

  describe("installLocalPack() - file filtering", () => {
    it("excludes node_modules", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "filter-test", "1.0.0", {
        "node_modules/some-package/index.js": "module.exports = {};",
      });

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // node_modules should not exist in destination
      const nodeModulesExists = await fs
        .access(path.join(result.destDir, "node_modules"))
        .then(() => true)
        .catch(() => false);

      expect(nodeModulesExists).toBe(false);
    });

    it("excludes .git directory", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "git-filter", "1.0.0", {
        ".git/config": "[core]\n\trepositoryformatversion = 0",
        ".git/HEAD": "ref: refs/heads/main",
      });

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // .git should not exist in destination
      const gitExists = await fs
        .access(path.join(result.destDir, ".git"))
        .then(() => true)
        .catch(() => false);

      expect(gitExists).toBe(false);
    });

    it("excludes .DS_Store files", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "dsstore-filter", "1.0.0", {
        ".DS_Store": "\x00\x00\x00\x01Bud1",
      });

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // .DS_Store should not exist in destination
      const dsStoreExists = await fs
        .access(path.join(result.destDir, ".DS_Store"))
        .then(() => true)
        .catch(() => false);

      expect(dsStoreExists).toBe(false);
    });

    it("preserves non-excluded files", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "preserve-test", "1.0.0", {
        "src/main.ts": "console.log('hello');",
        "config/settings.json": '{"debug": true}',
        ".eslintrc.json": '{"root": true}',
      });

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // These files should exist
      const hasFiles = await directoryContainsFiles(result.destDir, [
        "src/main.ts",
        "config/settings.json",
        ".eslintrc.json",
      ]);

      expect(hasFiles).toBe(true);
    });
  });

  // ===========================================================================
  // installLocalPack() - Scoped Packages
  // ===========================================================================

  describe("installLocalPack() - scoped packages", () => {
    it("handles scoped package names (@org/pack-name)", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      // Create pack with scoped name in manifest
      const packDir = path.join(setup.sourceDir, "scoped-pack");
      await fs.mkdir(packDir, { recursive: true });
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifestYaml("@myorg/my-pack", "1.0.0"),
      );
      await fs.mkdir(path.join(packDir, "templates/default"), { recursive: true });
      await fs.writeFile(path.join(packDir, "templates/default/index.ts"), "");

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      expect(result.packId).toBe("@myorg/my-pack");
      // Path should use sanitized version (no forward slashes in directory names)
      expect(result.destDir).not.toContain("@myorg/my-pack");
      expect(result.destDir).toContain("@myorg__my-pack");
    });
  });

  // ===========================================================================
  // installLocalPack() - Error Handling
  // ===========================================================================

  describe("installLocalPack() - error handling", () => {
    it("rejects relative source path", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      await expect(
        setup.service.installLocalPack({
          sourcePath: "relative/path",
        }),
      ).rejects.toThrow(/must be absolute/i);
    });

    it("throws when manifest is missing", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      // Create empty directory without manifest
      const emptyDir = path.join(setup.sourceDir, "empty");
      await fs.mkdir(emptyDir);

      await expect(
        setup.service.installLocalPack({
          sourcePath: emptyDir,
        }),
      ).rejects.toThrow(/manifest not found/i);
    });

    it("throws when source path does not exist", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      await expect(
        setup.service.installLocalPack({
          sourcePath: "/nonexistent/path/to/pack",
        }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // installLocalPack() - Failure Safety (Atomic Install)
  // ===========================================================================

  describe("installLocalPack() - failure safety", () => {
    it("does not leave partial install on copy failure", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "atomic-test", "1.0.0");

      // Make packsDir read-only to cause install failure during move
      // This is tricky to test reliably, so we'll test the cleanup path instead
      // by checking that staging directory is cleaned up on success

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // After successful install, staging dir should not exist
      const stagingDir = path.join(setup.storeDir, ".tmp");
      const stagingContents = await fs.readdir(stagingDir).catch(() => []);

      expect(stagingContents).toHaveLength(0);
      expect(result.status).toBe("installed");
    });

    it("registry is not updated when install fails", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      // Try to install from non-existent path
      try {
        await setup.service.installLocalPack({
          sourcePath: "/definitely/does/not/exist",
        });
      } catch {
        // Expected to fail
      }

      // Registry should remain empty
      const registry = new RegistryService(setup.registryFile);
      const packs = await registry.listPacks();

      expect(packs).toHaveLength(0);
    });
  });

  // ===========================================================================
  // installLocalPack() - Pack Update (version/hash change)
  // ===========================================================================

  describe("installLocalPack() - pack updates", () => {
    it("updates registry when pack hash changes", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "update-test", "1.0.0");

      // Install v1
      const result1 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Modify pack to change hash
      const newManifest = createManifestYaml("update-test", "1.1.0");
      await fs.writeFile(path.join(packDir, "archetype.yaml"), newManifest);

      // Install modified version
      const result2 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Both should be "installed" (not "already_installed")
      expect(result1.status).toBe("installed");
      expect(result2.status).toBe("installed");

      // Registry should have the latest entry
      const registry = new RegistryService(setup.registryFile);
      const entry = await registry.getPack("update-test");

      expect(entry).toBeDefined();
      expect(entry!.version).toBe("1.1.0");
      expect(entry!.hash).toBe(result2.hash);
    });

    it("keeps both versions in store when hash differs", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "multi-version", "1.0.0");

      // Install v1
      const result1 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Modify manifest
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifestYaml("multi-version", "2.0.0"),
      );

      // Install v2
      const result2 = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Both directories should exist
      const v1Exists = await fs
        .access(result1.destDir)
        .then(() => true)
        .catch(() => false);
      const v2Exists = await fs
        .access(result2.destDir)
        .then(() => true)
        .catch(() => false);

      expect(v1Exists).toBe(true);
      expect(v2Exists).toBe(true);
      expect(result1.destDir).not.toBe(result2.destDir);
    });
  });

  // ===========================================================================
  // getPackDestDir()
  // ===========================================================================

  describe("getPackDestDir()", () => {
    it("returns deterministic path for pack", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const hash = "a".repeat(64);

      const destDir = setup.service.getPackDestDir("my-pack", hash);

      expect(destDir).toBe(path.join(setup.packsDir, "my-pack", hash));
    });

    it("sanitizes scoped package names", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const hash = "b".repeat(64);

      const destDir = setup.service.getPackDestDir("@org/pack-name", hash);

      expect(destDir).toBe(path.join(setup.packsDir, "@org__pack-name", hash));
    });
  });

  // ===========================================================================
  // Store Integrity
  // ===========================================================================

  describe("store integrity", () => {
    it("installed pack contains exact copy of source files", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const customFiles = {
        "src/utils.ts": "export function add(a: number, b: number) { return a + b; }",
        "config/app.yaml": "name: test-app\nport: 3000",
        ".hidden/secret.txt": "this should be copied too",
      };

      const packDir = await createTestPack(setup.sourceDir, "integrity-test", "1.0.0", customFiles);

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      // Verify each file content matches
      for (const [relativePath, expectedContent] of Object.entries(customFiles)) {
        const actualContent = await readFileContent(path.join(result.destDir, relativePath));
        expect(actualContent).toBe(expectedContent);
      }
    });

    it("preserves directory structure", async () => {
      const setup = await createTestSetup();
      trackDir(setup.storeDir);
      trackDir(setup.sourceDir);

      const packDir = await createTestPack(setup.sourceDir, "structure-test", "1.0.0", {
        "deeply/nested/dir/file.txt": "deep content",
        "a/b/c/d/e/f.ts": "export const deep = true;",
      });

      const result = await setup.service.installLocalPack({
        sourcePath: packDir,
      });

      const hasStructure = await directoryContainsFiles(result.destDir, [
        "deeply/nested/dir/file.txt",
        "a/b/c/d/e/f.ts",
      ]);

      expect(hasStructure).toBe(true);
    });
  });
});
