/**
 * Integration tests for conflict detection in generateHandler.
 *
 * Tests the fail-fast conflict detection that runs BEFORE staging begins.
 * Uses ConflictDetector to scan target directory upfront.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  handleGenerate,
  type GenerateDependencies,
} from "../src/cli/handlers/generateHandler.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";
import { GenerateConflictError } from "../src/core/conflicts/ConflictDetector.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-conflict-${prefix}-`));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function readFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizePackId(packId: string): string {
  return packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
}

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

async function writeRegistry(registryFile: string, registry: Registry): Promise<void> {
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2));
}

/**
 * Creates a complete test pack with manifest and templates.
 */
async function createTestPack(
  packsDir: string,
  packId: string,
  hash: string,
  options: {
    archetypes: Array<{
      id: string;
      templateRoot: string;
      files: Array<{ name: string; content: string }>;
    }>;
  }
): Promise<string> {
  const sanitizedId = sanitizePackId(packId);
  const packDir = path.join(packsDir, sanitizedId, hash);
  await fs.mkdir(packDir, { recursive: true });

  // Create manifest
  const archetypesList = options.archetypes
    .map((a) => `  - id: ${a.id}\n    templateRoot: ${a.templateRoot}`)
    .join("\n");

  const quotedName = packId.startsWith("@") || packId.includes(":") ? `"${packId}"` : packId;
  const manifest = `pack:
  name: ${quotedName}
  version: "1.0.0"
archetypes:
${archetypesList}
`;
  await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

  // Create template directories and files
  for (const archetype of options.archetypes) {
    const templateDir = path.join(packDir, archetype.templateRoot);
    await fs.mkdir(templateDir, { recursive: true });

    for (const file of archetype.files) {
      const filePath = path.join(templateDir, file.name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content);
    }
  }

  return packDir;
}

async function createTestDependencies(): Promise<{
  storeDir: string;
  packsDir: string;
  deps: GenerateDependencies;
  registryFile: string;
}> {
  const storeDir = await createTestDir("store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  await fs.mkdir(packsDir, { recursive: true });

  const deps: GenerateDependencies = {
    registryFile,
    packsDir,
    storeDir,
  };

  return { storeDir, packsDir, deps, registryFile };
}

// =============================================================================
// Tests
// =============================================================================

describe("generateHandler conflict detection", () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    for (const dir of testDirs) {
      await cleanupTempDir(dir);
    }
    testDirs.length = 0;
  });

  function trackDir(dir: string): string {
    testDirs.push(dir);
    return dir;
  }

  const PACK_HASH = "a".repeat(64);

  // ===========================================================================
  // Default behavior - fail on conflict
  // ===========================================================================

  describe("default behavior (no --force)", () => {
    it("fails with GenerateConflictError when target has conflicting files", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      // Create pack
      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [
              { name: "README.md", content: "# {{projectName}}" },
              { name: "src/index.ts", content: "// {{projectName}}" },
            ],
          },
        ],
      });

      // Register pack
      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Pre-create a conflicting file
      await writeFile(path.join(targetDir, "README.md"), "Existing content");

      await expect(
        handleGenerate(
          {
            ref: "test-pack:default",
            targetDir,
            dryRun: false,
            data: { projectName: "Test" },
            force: false,
          },
          deps
        )
      ).rejects.toThrow(GenerateConflictError);
    });

    it("error includes conflicting file paths", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [
              { name: "README.md", content: "# {{projectName}}" },
              { name: "src/index.ts", content: "// Code" },
            ],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Pre-create conflicting files
      await writeFile(path.join(targetDir, "README.md"), "Existing");
      await writeFile(path.join(targetDir, "src", "index.ts"), "Existing");

      try {
        await handleGenerate(
          {
            ref: "test-pack:default",
            targetDir,
            dryRun: false,
            data: { projectName: "Test" },
            force: false,
          },
          deps
        );
        expect.fail("Should have thrown GenerateConflictError");
      } catch (err: any) {
        expect(err).toBeInstanceOf(GenerateConflictError);
        expect(err.conflictReport.hasConflicts).toBe(true);
        expect(err.conflictReport.count).toBe(2);

        // Error hint should mention --force
        expect(err.hint).toContain("--force");
      }
    });

    it("does not modify target when conflicts detected", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      const existingContent = "Original content - must not change";
      await writeFile(path.join(targetDir, "README.md"), existingContent);

      try {
        await handleGenerate(
          {
            ref: "test-pack:default",
            targetDir,
            dryRun: false,
            data: { projectName: "Test" },
            force: false,
          },
          deps
        );
      } catch {
        // Expected to throw
      }

      // Verify file was not modified
      const content = await readFile(path.join(targetDir, "README.md"));
      expect(content).toBe(existingContent);
    });

    it("succeeds when no conflicts exist", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Empty target directory - no conflicts
      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "Test" },
          force: false,
        },
        deps
      );

      expect(result.filesWritten.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // With --force - allow overwrite
  // ===========================================================================

  describe("with --force", () => {
    it("succeeds and overwrites conflicting files", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Pre-create a conflicting file
      await writeFile(path.join(targetDir, "README.md"), "Old content");

      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "NewProject" },
          force: true,
        },
        deps
      );

      // Verify success
      expect(result.filesWritten.length).toBeGreaterThan(0);

      // Verify file was overwritten with new content
      const content = await readFile(path.join(targetDir, "README.md"));
      expect(content).toContain("NewProject");
    });

    it("proceeds and generates files even when conflicts exist", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [
              { name: "README.md", content: "# {{projectName}}" },
              { name: "new-file.txt", content: "New content" },
            ],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Pre-create conflicting file
      await writeFile(path.join(targetDir, "README.md"), "Old");

      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "Test" },
          force: true,
        },
        deps
      );

      // Verify all files were written
      expect(result.filesWritten.length).toBe(2);

      // Verify both existing and new files are present
      const readmeContent = await readFile(path.join(targetDir, "README.md"));
      expect(readmeContent).toContain("Test");

      const newFileContent = await readFile(path.join(targetDir, "new-file.txt"));
      expect(newFileContent).toBe("New content");
    });
  });

  // ===========================================================================
  // Re-generation scenario
  // ===========================================================================

  describe("re-generation scenario", () => {
    it("first generation succeeds, second fails without --force", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // First generation - should succeed
      const result1 = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "FirstGen" },
          force: false,
        },
        deps
      );
      expect(result1.filesWritten.length).toBeGreaterThan(0);

      // Second generation (same target) - should fail
      await expect(
        handleGenerate(
          {
            ref: "test-pack:default",
            targetDir,
            dryRun: false,
            data: { projectName: "SecondGen" },
            force: false,
          },
          deps
        )
      ).rejects.toThrow(GenerateConflictError);
    });

    it("second generation succeeds with --force", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // First generation
      await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "FirstGen" },
          force: false,
        },
        deps
      );

      // Second generation with force - should succeed
      const result2 = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "SecondGen" },
          force: true,
        },
        deps
      );

      expect(result2.filesWritten.length).toBeGreaterThan(0);

      // Verify content reflects second generation
      const content = await readFile(path.join(targetDir, "README.md"));
      expect(content).toContain("SecondGen");
    });
  });

  // ===========================================================================
  // Dry-run with conflicts
  // ===========================================================================

  describe("dry-run with conflicts", () => {
    it("dry-run shows MODIFY in preview instead of throwing", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await writeFile(path.join(targetDir, "README.md"), "Existing content");

      // Dry-run should NOT throw - it shows preview instead
      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: true,
          data: { projectName: "Test" },
          force: false,
        },
        deps
      );

      // Should return preview report with MODIFY operation
      expect(result.dryRun).toBe(true);
      expect(result.previewReport).toBeDefined();
      expect(result.previewReport!.hasModifications).toBe(true);
      expect(result.previewReport!.modifies.length).toBe(1);
      expect(result.previewReport!.modifies[0].relativePath).toBe("README.md");

      // File should not be modified
      const content = await readFile(path.join(targetDir, "README.md"));
      expect(content).toBe("Existing content");
    });

    it("dry-run with force succeeds without modifying disk", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      await createTestPack(packsDir, "test-pack", PACK_HASH, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates/default",
            files: [{ name: "README.md", content: "# {{projectName}}" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/fake/path" },
          hash: PACK_HASH,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await writeFile(path.join(targetDir, "README.md"), "Original");

      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: true,
          data: { projectName: "Test" },
          force: true,
        },
        deps
      );

      // Dry-run should return planned files
      expect(result.dryRun).toBe(true);
      expect(result.filesPlanned.length).toBeGreaterThan(0);

      // File should not be modified
      const content = await readFile(path.join(targetDir, "README.md"));
      expect(content).toBe("Original");
    });
  });
});
