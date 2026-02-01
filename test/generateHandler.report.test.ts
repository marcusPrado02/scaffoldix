/**
 * Tests for generation report persistence in handleGenerate.
 *
 * Verifies that full generation reports (patches, hooks, checks, status)
 * are persisted to `.scaffoldix/state.json` per T20 spec.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { handleGenerate, type GenerateDependencies } from "../src/cli/handlers/generateHandler.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";
import { ProjectStateManager, type ProjectStateV2 } from "../src/core/state/ProjectStateManager.js";

// =============================================================================
// Test Helpers
// =============================================================================

interface TestWorkspace {
  storeDir: string;
  packsDir: string;
  registryFile: string;
  targetDir: string;
  deps: GenerateDependencies;
}

async function createTestWorkspace(): Promise<TestWorkspace> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-report-gen-test");
  await fs.mkdir(baseDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(baseDir, "test-"));

  const storeDir = path.join(tempDir, "store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");
  const targetDir = path.join(tempDir, "target");

  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(packsDir, { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });

  const deps: GenerateDependencies = {
    registryFile,
    packsDir,
    storeDir,
  };

  return { storeDir, packsDir, registryFile, targetDir, deps };
}

async function cleanupWorkspace(workspace: TestWorkspace): Promise<void> {
  const baseDir = path.dirname(workspace.storeDir);
  await fs.rm(baseDir, { recursive: true, force: true });
}

function sanitizePackId(packId: string): string {
  return packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
}

function createRegistry(
  packs: Array<{
    id: string;
    version: string;
    origin: PackOrigin;
    hash: string;
    installedAt?: string;
  }>
): Registry {
  const packsRecord: Registry["packs"] = {};
  for (const pack of packs) {
    packsRecord[pack.id] = {
      id: pack.id,
      version: pack.version,
      origin: pack.origin,
      hash: pack.hash,
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
 * Creates a test pack with manifest and templates.
 */
async function createTestPack(
  packsDir: string,
  packId: string,
  hash: string,
  options: {
    version?: string;
    archetypes: Array<{
      id: string;
      templateRoot: string;
      files?: Array<{ name: string; content: string }>;
      patches?: Array<{
        kind: string;
        file: string;
        markerStart: string;
        markerEnd: string;
        contentTemplate?: string;
        path?: string;
        idempotencyKey: string;
      }>;
      postGenerate?: string[];
      checks?: string[];
    }>;
  }
): Promise<string> {
  const sanitizedId = sanitizePackId(packId);
  const packDir = path.join(packsDir, sanitizedId, hash);
  await fs.mkdir(packDir, { recursive: true });

  // Build archetypes YAML
  const archetypesList = options.archetypes
    .map((a) => {
      let yaml = `  - id: ${a.id}\n    templateRoot: ${a.templateRoot}`;
      if (a.patches && a.patches.length > 0) {
        yaml += "\n    patches:";
        for (const p of a.patches) {
          yaml += `\n      - file: ${p.file}`;
          yaml += `\n        kind: ${p.kind}`;
          yaml += `\n        markerStart: "${p.markerStart}"`;
          yaml += `\n        markerEnd: "${p.markerEnd}"`;
          if (p.contentTemplate) yaml += `\n        contentTemplate: "${p.contentTemplate}"`;
          if (p.path) yaml += `\n        path: ${p.path}`;
          yaml += `\n        idempotencyKey: ${p.idempotencyKey}`;
        }
      }
      if (a.postGenerate && a.postGenerate.length > 0) {
        yaml += "\n    postGenerate:";
        for (const cmd of a.postGenerate) {
          yaml += `\n      - "${cmd}"`;
        }
      }
      if (a.checks && a.checks.length > 0) {
        yaml += "\n    checks:";
        for (const cmd of a.checks) {
          yaml += `\n      - "${cmd}"`;
        }
      }
      return yaml;
    })
    .join("\n");

  const quotedName = packId.startsWith("@") || packId.includes(":") ? `"${packId}"` : packId;
  const version = options.version ?? "1.0.0";
  const manifest = `pack:
  name: ${quotedName}
  version: "${version}"
archetypes:
${archetypesList}
`;
  await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

  // Create template directories and files
  for (const archetype of options.archetypes) {
    const templateDir = path.join(packDir, archetype.templateRoot);
    await fs.mkdir(templateDir, { recursive: true });

    if (archetype.files) {
      for (const file of archetype.files) {
        const filePath = path.join(templateDir, file.name);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content);
      }
    }
  }

  return packDir;
}

// =============================================================================
// Tests
// =============================================================================

describe("generateHandler - generation report persistence", () => {
  let workspace: TestWorkspace;
  let stateManager: ProjectStateManager;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
    stateManager = new ProjectStateManager();
  });

  afterEach(async () => {
    await cleanupWorkspace(workspace);
  });

  // ===========================================================================
  // Success Report Persistence
  // ===========================================================================

  describe("success report persistence", () => {
    it("persists full generation report with v2 schema on success", async () => {
      const hash = "a".repeat(64);

      // Create pack
      await createTestPack(workspace.packsDir, "report-test-pack", hash, {
        version: "1.0.0",
        archetypes: [
          {
            id: "simple",
            templateRoot: "templates/simple",
            files: [{ name: "hello.txt", content: "Hello from template!" }],
          },
        ],
      });

      // Register pack
      const registry = createRegistry([
        {
          id: "report-test-pack",
          version: "1.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      // Run generate
      await handleGenerate(
        {
          ref: "report-test-pack:simple",
          targetDir: workspace.targetDir,
          dryRun: false,
          data: { name: "Test" },
        },
        workspace.deps
      );

      // Read state from target
      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;

      expect(state).not.toBeNull();
      expect(state.schemaVersion).toBe(2);
      expect(state.generations).toHaveLength(1);

      const gen = state.generations[0];
      expect(gen.packId).toBe("report-test-pack");
      expect(gen.packVersion).toBe("1.0.0");
      expect(gen.archetypeId).toBe("simple");
      expect(gen.inputs).toEqual({ name: "Test" });
      expect(gen.status).toBe("success");
      expect(gen.id).toBeDefined();
      expect(gen.timestamp).toBeDefined();
    });

    it("persists patches summary when patches are applied", async () => {
      const hash = "b".repeat(64);

      // Create pack with patches - template includes file with markers
      const packDir = await createTestPack(workspace.packsDir, "patch-report-pack", hash, {
        version: "2.0.0",
        archetypes: [
          {
            id: "with-patch",
            templateRoot: "templates",
            files: [
              {
                name: "app.ts",
                content: `// App file\n// <SCAFFOLDIX:START:imports>\n// imports here\n// <SCAFFOLDIX:END:imports>\n`,
              },
            ],
            patches: [
              {
                kind: "marker_insert",
                file: "app.ts",
                markerStart: "// <SCAFFOLDIX:START:imports>",
                markerEnd: "// <SCAFFOLDIX:END:imports>",
                path: "patches/import.txt",
                idempotencyKey: "add-import",
              },
            ],
          },
        ],
      });

      // Create patch content file
      const patchesDir = path.join(packDir, "patches");
      await fs.mkdir(patchesDir, { recursive: true });
      await fs.writeFile(path.join(patchesDir, "import.txt"), "import { foo } from 'bar';");

      // Register pack
      const registry = createRegistry([
        {
          id: "patch-report-pack",
          version: "2.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      await handleGenerate(
        {
          ref: "patch-report-pack:with-patch",
          targetDir: workspace.targetDir,
          dryRun: false,
          data: {},
        },
        workspace.deps
      );

      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;
      const gen = state.generations[0];

      expect(gen.patches).toBeDefined();
      expect(gen.patches!.total).toBe(1);
      expect(gen.patches!.items).toHaveLength(1);
      expect(gen.patches!.items[0].kind).toBe("marker_insert");
      expect(gen.patches!.items[0].idempotencyKey).toBe("add-import");
    });

    it("persists hooks summary when hooks are executed", async () => {
      const hash = "c".repeat(64);

      await createTestPack(workspace.packsDir, "hook-report-pack", hash, {
        version: "1.0.0",
        archetypes: [
          {
            id: "with-hook",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "Content" }],
            postGenerate: ["echo 'Hook executed'"],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "hook-report-pack",
          version: "1.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      await handleGenerate(
        {
          ref: "hook-report-pack:with-hook",
          targetDir: workspace.targetDir,
          dryRun: false,
          data: {},
        },
        workspace.deps
      );

      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;
      const gen = state.generations[0];

      expect(gen.hooks).toBeDefined();
      expect(gen.hooks!.items).toHaveLength(1);
      expect(gen.hooks!.items[0].command).toBe("echo 'Hook executed'");
      expect(gen.hooks!.items[0].status).toBe("success");
      expect(gen.hooks!.items[0].exitCode).toBe(0);
    });

    it("persists checks summary when checks are executed", async () => {
      const hash = "d".repeat(64);

      await createTestPack(workspace.packsDir, "check-report-pack", hash, {
        version: "1.0.0",
        archetypes: [
          {
            id: "with-check",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "Content" }],
            checks: ["echo 'Check passed'"],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "check-report-pack",
          version: "1.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      await handleGenerate(
        {
          ref: "check-report-pack:with-check",
          targetDir: workspace.targetDir,
          dryRun: false,
          data: {},
        },
        workspace.deps
      );

      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;
      const gen = state.generations[0];

      expect(gen.checks).toBeDefined();
      expect(gen.checks!.items).toHaveLength(1);
      expect(gen.checks!.items[0].command).toBe("echo 'Check passed'");
      expect(gen.checks!.items[0].status).toBe("success");
      expect(gen.checks!.items[0].exitCode).toBe(0);
    });

    it("accumulates generation history on repeated runs", async () => {
      const hash = "e".repeat(64);

      await createTestPack(workspace.packsDir, "history-pack", hash, {
        version: "1.0.0",
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "Content" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "history-pack",
          version: "1.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      // Run generation three times (force needed for re-generation)
      for (let i = 0; i < 3; i++) {
        await handleGenerate(
          {
            ref: "history-pack:default",
            targetDir: workspace.targetDir,
            dryRun: false,
            data: { run: i },
            force: i > 0, // Force for subsequent runs to handle conflicts
          },
          workspace.deps
        );
      }

      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;

      expect(state.generations).toHaveLength(3);
      expect(state.generations[0].inputs).toEqual({ run: 0 });
      expect(state.generations[1].inputs).toEqual({ run: 1 });
      expect(state.generations[2].inputs).toEqual({ run: 2 });
    });
  });

  // ===========================================================================
  // Failure Report Persistence
  // ===========================================================================

  describe("failure report persistence", () => {
    it("does not modify target state on failure (staging cleanup)", async () => {
      const hash = "f".repeat(64);

      // Install a pack with a check that will fail
      await createTestPack(workspace.packsDir, "fail-pack", hash, {
        version: "1.0.0",
        archetypes: [
          {
            id: "will-fail",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "Content" }],
            // A check that fails
            checks: ["exit 1"],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "fail-pack",
          version: "1.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      // This should throw because check fails
      await expect(
        handleGenerate(
          {
            ref: "fail-pack:will-fail",
            targetDir: workspace.targetDir,
            dryRun: false,
            data: {},
          },
          workspace.deps
        )
      ).rejects.toThrow();

      // Target state should NOT be modified (generation failed)
      const targetState = await stateManager.read(workspace.targetDir);
      expect(targetState).toBeNull();
    });
  });

  // ===========================================================================
  // lastGeneration Backward Compatibility
  // ===========================================================================

  describe("lastGeneration backward compatibility", () => {
    it("sets lastGeneration to most recent generation", async () => {
      // Use valid hex character (a-f, 0-9) for hash
      const hash = "0".repeat(64);

      await createTestPack(workspace.packsDir, "compat-pack", hash, {
        version: "3.0.0",
        archetypes: [
          {
            id: "compat-arch",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "Content" }],
          },
        ],
      });

      const registry = createRegistry([
        {
          id: "compat-pack",
          version: "3.0.0",
          hash,
          origin: { type: "local", localPath: "/mock/path" },
        },
      ]);
      await writeRegistry(workspace.registryFile, registry);

      await handleGenerate(
        {
          ref: "compat-pack:compat-arch",
          targetDir: workspace.targetDir,
          dryRun: false,
          data: { foo: "bar" },
        },
        workspace.deps
      );

      const state = (await stateManager.read(workspace.targetDir)) as ProjectStateV2;

      // lastGeneration should mirror the most recent entry for v1 consumers
      expect(state.lastGeneration.packId).toBe("compat-pack");
      expect(state.lastGeneration.packVersion).toBe("3.0.0");
      expect(state.lastGeneration.archetypeId).toBe("compat-arch");
      expect(state.lastGeneration.inputs).toEqual({ foo: "bar" });
    });
  });
});
