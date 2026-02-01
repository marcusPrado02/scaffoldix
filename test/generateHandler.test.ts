import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handleGenerate,
  parseArchetypeRef,
  formatGenerateOutput,
  formatTraceOutput,
  type GenerateInput,
  type GenerateDependencies,
  type GenerateResult,
} from "../src/cli/handlers/generateHandler.js";
import type { TraceJson } from "../src/core/observability/EngineTrace.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type Registry,
  type PackOrigin,
} from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-generate-${prefix}-`));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
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

function sanitizePackId(packId: string): string {
  return packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, "utf-8");
}

// =============================================================================
// Tests
// =============================================================================

describe("generateHandler", () => {
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
  // parseArchetypeRef()
  // ===========================================================================

  describe("parseArchetypeRef()", () => {
    it("parses valid packId:archetypeId format", () => {
      const result = parseArchetypeRef("my-pack:default");
      expect(result).toEqual({ packId: "my-pack", archetypeId: "default" });
    });

    it("parses scoped package names", () => {
      const result = parseArchetypeRef("@org/my-pack:component");
      expect(result).toEqual({ packId: "@org/my-pack", archetypeId: "component" });
    });

    it("throws on missing colon", () => {
      expect(() => parseArchetypeRef("my-pack-default")).toThrow();
    });

    it("throws on empty packId", () => {
      expect(() => parseArchetypeRef(":default")).toThrow();
    });

    it("throws on empty archetypeId", () => {
      expect(() => parseArchetypeRef("my-pack:")).toThrow();
    });

    it("error includes usage example", () => {
      try {
        parseArchetypeRef("invalid");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("packId:archetypeId");
      }
    });
  });

  // ===========================================================================
  // handleGenerate() - Success Cases
  // ===========================================================================

  describe("handleGenerate() - success", () => {
    it("generates files from valid pack and archetype", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "a".repeat(64);

      // Create registry
      const registry = createRegistry([
        {
          id: "test-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/test" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack with templates
      await createTestPack(packsDir, "test-pack", hash, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [
              { name: "README.md", content: "# {{projectName}}" },
              { name: "src/index.ts", content: "// {{projectName}}" },
            ],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "test-pack:default",
          targetDir,
          dryRun: false,
          data: { projectName: "MyProject" },
        },
        deps
      );

      expect(result.filesWritten.length).toBe(2);
      expect(await fileExists(path.join(targetDir, "README.md"))).toBe(true);
      expect(await fileExists(path.join(targetDir, "src/index.ts"))).toBe(true);

      const readme = await readFile(path.join(targetDir, "README.md"));
      expect(readme).toBe("# MyProject");
    });

    it("returns correct result structure", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "b".repeat(64);

      const registry = createRegistry([
        {
          id: "result-pack",
          version: "2.0.0",
          origin: { type: "local", localPath: "/result" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "result-pack", hash, {
        archetypes: [
          {
            id: "api",
            templateRoot: "templates/api",
            files: [{ name: "handler.ts", content: "export {}" }],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "result-pack:api",
          targetDir,
          dryRun: false,
          data: {},
        },
        deps
      );

      expect(result.packId).toBe("result-pack");
      expect(result.archetypeId).toBe("api");
      expect(result.targetDir).toBe(targetDir);
      expect(result.dryRun).toBe(false);
      expect(result.filesWritten.length).toBe(1);
    });
  });

  // ===========================================================================
  // handleGenerate() - Pack Not Found
  // ===========================================================================

  describe("handleGenerate() - pack not found", () => {
    it("throws clear error when pack is not installed", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      // Empty registry
      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      await expect(
        handleGenerate(
          {
            ref: "nonexistent-pack:default",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        )
      ).rejects.toMatchObject({
        code: "PACK_NOT_FOUND",
      });
    });

    it("error suggests pack list command", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      try {
        await handleGenerate(
          {
            ref: "missing-pack:arch",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("pack list");
      }
    });
  });

  // ===========================================================================
  // handleGenerate() - Archetype Not Found
  // ===========================================================================

  describe("handleGenerate() - archetype not found", () => {
    it("throws clear error when archetype does not exist", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "c".repeat(64);

      const registry = createRegistry([
        {
          id: "arch-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/arch" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack with different archetype
      await createTestPack(packsDir, "arch-pack", hash, {
        archetypes: [
          {
            id: "existing",
            templateRoot: "templates",
            files: [{ name: "file.txt", content: "content" }],
          },
        ],
      });

      await expect(
        handleGenerate(
          {
            ref: "arch-pack:nonexistent",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        )
      ).rejects.toMatchObject({
        code: "ARCHETYPE_NOT_FOUND",
      });
    });

    it("error includes pack info command suggestion", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "d".repeat(64);

      const registry = createRegistry([
        {
          id: "hint-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/hint" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "hint-pack", hash, {
        archetypes: [
          {
            id: "only-one",
            templateRoot: "templates",
            files: [{ name: "f.txt", content: "" }],
          },
        ],
      });

      try {
        await handleGenerate(
          {
            ref: "hint-pack:wrong-arch",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("pack info");
      }
    });
  });

  // ===========================================================================
  // handleGenerate() - Dry Run
  // ===========================================================================

  describe("handleGenerate() - dry run", () => {
    it("returns planned files without writing", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "e".repeat(64);

      const registry = createRegistry([
        {
          id: "dry-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/dry" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "dry-pack", hash, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [
              { name: "file1.txt", content: "content1" },
              { name: "file2.txt", content: "content2" },
            ],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "dry-pack:default",
          targetDir,
          dryRun: true,
          data: {},
        },
        deps
      );

      expect(result.dryRun).toBe(true);
      expect(result.filesPlanned.length).toBe(2);
      expect(result.filesWritten.length).toBe(0);

      // Target directory should be empty
      const files = await fs.readdir(targetDir).catch(() => []);
      expect(files.length).toBe(0);
    });

    it("includes correct planned file paths", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "f".repeat(64);

      const registry = createRegistry([
        {
          id: "plan-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/plan" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "plan-pack", hash, {
        archetypes: [
          {
            id: "nested",
            templateRoot: "templates",
            files: [{ name: "src/deep/file.ts", content: "" }],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "plan-pack:nested",
          targetDir,
          dryRun: true,
          data: {},
        },
        deps
      );

      expect(result.filesPlanned[0].destRelativePath).toBe(
        path.join("src", "deep", "file.ts")
      );
    });
  });

  // ===========================================================================
  // handleGenerate() - Template Directory Validation
  // ===========================================================================

  describe("handleGenerate() - templateDir validation", () => {
    it("throws when templateRoot directory does not exist", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "0".repeat(64);

      const registry = createRegistry([
        {
          id: "bad-template-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/bad" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack but WITHOUT the templates directory
      const packDir = path.join(packsDir, sanitizePackId("bad-template-pack"), hash);
      await fs.mkdir(packDir, { recursive: true });

      const manifest = `pack:
  name: bad-template-pack
  version: "1.0.0"
archetypes:
  - id: broken
    templateRoot: nonexistent-dir
`;
      await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

      await expect(
        handleGenerate(
          {
            ref: "bad-template-pack:broken",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        )
      ).rejects.toMatchObject({
        code: "TEMPLATE_DIR_NOT_FOUND",
      });
    });
  });

  // ===========================================================================
  // handleGenerate() - Store Path Missing
  // ===========================================================================

  describe("handleGenerate() - store path missing", () => {
    it("throws when pack store path does not exist", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));

      // Registry points to nonexistent pack directory
      const registry = createRegistry([
        {
          id: "ghost-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/ghost" },
          hash: "1".repeat(64),
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Don't create the pack directory

      await expect(
        handleGenerate(
          {
            ref: "ghost-pack:default",
            targetDir,
            dryRun: false,
            data: {},
          },
          deps
        )
      ).rejects.toMatchObject({
        code: "PACK_STORE_MISSING",
      });
    });
  });

  // ===========================================================================
  // handleGenerate() - Template Rendering
  // ===========================================================================

  describe("handleGenerate() - rendering", () => {
    it("renders Handlebars variables in templates", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "2".repeat(64);

      const registry = createRegistry([
        {
          id: "hbs-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/hbs" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "hbs-pack", hash, {
        archetypes: [
          {
            id: "entity",
            templateRoot: "templates",
            files: [
              { name: "{{EntityName}}.ts", content: "export class {{EntityName}} {}" },
            ],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "hbs-pack:entity",
          targetDir,
          dryRun: false,
          data: { EntityName: "Customer" },
        },
        deps
      );

      expect(result.filesWritten.length).toBe(1);
      // Note: filename vars need rename rules, but content should be rendered
      // Target dir will have the template file + .scaffoldix directory
      const files = await fs.readdir(targetDir);
      expect(files.filter((f) => f !== ".scaffoldix").length).toBe(1);
    });

    it("preserves directory structure", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "3".repeat(64);

      const registry = createRegistry([
        {
          id: "struct-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/struct" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "struct-pack", hash, {
        archetypes: [
          {
            id: "full",
            templateRoot: "templates",
            files: [
              { name: "src/index.ts", content: "" },
              { name: "src/utils/helper.ts", content: "" },
              { name: "tests/index.test.ts", content: "" },
            ],
          },
        ],
      });

      await handleGenerate(
        {
          ref: "struct-pack:full",
          targetDir,
          dryRun: false,
          data: {},
        },
        deps
      );

      expect(await fileExists(path.join(targetDir, "src", "index.ts"))).toBe(true);
      expect(await fileExists(path.join(targetDir, "src", "utils", "helper.ts"))).toBe(
        true
      );
      expect(await fileExists(path.join(targetDir, "tests", "index.test.ts"))).toBe(true);
    });
  });

  // ===========================================================================
  // formatGenerateOutput()
  // ===========================================================================

  describe("formatGenerateOutput()", () => {
    it("formats successful generation output", () => {
      const result: GenerateResult = {
        packId: "my-pack",
        archetypeId: "default",
        targetDir: "/home/user/project",
        dryRun: false,
        filesWritten: [
          { srcRelativePath: "a.ts", destRelativePath: "a.ts", mode: "rendered" },
          { srcRelativePath: "b.ts", destRelativePath: "b.ts", mode: "rendered" },
        ],
        filesPlanned: [],
      };

      const lines = formatGenerateOutput(result);

      expect(lines.some((l) => l.includes("my-pack:default"))).toBe(true);
      expect(lines.some((l) => l.includes("2 files"))).toBe(true);
    });

    it("formats dry run output with header", () => {
      const result: GenerateResult = {
        packId: "my-pack",
        archetypeId: "default",
        targetDir: "/home/user/project",
        dryRun: true,
        filesWritten: [],
        filesPlanned: [
          { srcRelativePath: "a.ts", destRelativePath: "a.ts", mode: "rendered" },
        ],
      };

      const lines = formatGenerateOutput(result);

      expect(lines.some((l) => l.toLowerCase().includes("dry run"))).toBe(true);
      expect(lines.some((l) => l.includes("1 file"))).toBe(true);
    });

    it("includes target directory in output", () => {
      const result: GenerateResult = {
        packId: "p",
        archetypeId: "a",
        targetDir: "/custom/target/path",
        dryRun: false,
        filesWritten: [],
        filesPlanned: [],
      };

      const lines = formatGenerateOutput(result);

      expect(lines.some((l) => l.includes("/custom/target/path"))).toBe(true);
    });
  });

  // ===========================================================================
  // formatTraceOutput()
  // ===========================================================================

  describe("formatTraceOutput()", () => {
    it("formats trace with phase names and durations", () => {
      const trace: TraceJson = {
        trace: [
          { name: "resolve pack", start: "2024-01-01T10:00:00.000Z", end: "2024-01-01T10:00:00.050Z", durationMs: 50 },
          { name: "load manifest", start: "2024-01-01T10:00:00.050Z", end: "2024-01-01T10:00:00.100Z", durationMs: 50 },
          { name: "render templates", start: "2024-01-01T10:00:00.100Z", end: "2024-01-01T10:00:00.250Z", durationMs: 150 },
        ],
        totalDurationMs: 250,
      };

      const lines = formatTraceOutput(trace);

      expect(lines.some((l) => l.includes("resolve pack"))).toBe(true);
      expect(lines.some((l) => l.includes("load manifest"))).toBe(true);
      expect(lines.some((l) => l.includes("render templates"))).toBe(true);
      expect(lines.some((l) => l.includes("50ms"))).toBe(true);
      expect(lines.some((l) => l.includes("150ms"))).toBe(true);
      expect(lines.some((l) => l.includes("Completed in 250ms"))).toBe(true);
    });

    it("returns empty array for empty trace", () => {
      const trace: TraceJson = {
        trace: [],
        totalDurationMs: 0,
      };

      const lines = formatTraceOutput(trace);

      expect(lines).toHaveLength(0);
    });

    it("formats duration as seconds for long phases", () => {
      const trace: TraceJson = {
        trace: [
          { name: "slow phase", start: "2024-01-01T10:00:00.000Z", end: "2024-01-01T10:00:02.500Z", durationMs: 2500 },
        ],
        totalDurationMs: 2500,
      };

      const lines = formatTraceOutput(trace);

      expect(lines.some((l) => l.includes("2.50s"))).toBe(true);
    });

    it("shows in progress for phases without end time", () => {
      const trace: TraceJson = {
        trace: [
          { name: "running phase", start: "2024-01-01T10:00:00.000Z" },
        ],
        totalDurationMs: 0,
      };

      const lines = formatTraceOutput(trace);

      expect(lines.some((l) => l.includes("in progress"))).toBe(true);
    });
  });

  // ===========================================================================
  // State File Integration
  // ===========================================================================

  describe("state file integration", () => {
    it("creates .scaffoldix/state.json after successful generation", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "5".repeat(64);

      const registry = createRegistry([
        {
          id: "state-pack",
          version: "1.2.3",
          origin: { type: "local", localPath: "/state" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "state-pack", hash, {
        archetypes: [
          {
            id: "entity",
            templateRoot: "templates",
            files: [{ name: "file.ts", content: "// content" }],
          },
        ],
      });

      await handleGenerate(
        {
          ref: "state-pack:entity",
          targetDir,
          dryRun: false,
          data: { name: "TestEntity" },
        },
        deps
      );

      // Verify state file was created
      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      expect(await fileExists(stateFile)).toBe(true);

      // Verify state content
      const stateContent = await readFile(stateFile);
      const state = JSON.parse(stateContent);

      expect(state.schemaVersion).toBe(2);
      expect(state.lastGeneration.packId).toBe("state-pack");
      expect(state.lastGeneration.packVersion).toBe("1.2.3");
      expect(state.lastGeneration.archetypeId).toBe("entity");
      expect(state.lastGeneration.inputs).toEqual({ name: "TestEntity" });
      expect(state.lastGeneration.timestamp).toBeDefined();
    });

    it("does NOT create state file on dry-run", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "6".repeat(64);

      const registry = createRegistry([
        {
          id: "dry-state-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/dry-state" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "dry-state-pack", hash, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [{ name: "file.ts", content: "" }],
          },
        ],
      });

      await handleGenerate(
        {
          ref: "dry-state-pack:default",
          targetDir,
          dryRun: true, // Dry run!
          data: {},
        },
        deps
      );

      // Verify state file was NOT created
      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      expect(await fileExists(stateFile)).toBe(false);
    });

    it("updates state file on re-generation", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "7".repeat(64);

      const registry = createRegistry([
        {
          id: "regen-pack",
          version: "2.0.0",
          origin: { type: "local", localPath: "/regen" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "regen-pack", hash, {
        archetypes: [
          {
            id: "first",
            templateRoot: "templates",
            files: [{ name: "file.ts", content: "" }],
          },
          {
            id: "second",
            templateRoot: "templates",
            files: [{ name: "file.ts", content: "" }],
          },
        ],
      });

      // First generation
      await handleGenerate(
        {
          ref: "regen-pack:first",
          targetDir,
          dryRun: false,
          data: { v: 1 },
        },
        deps
      );

      const stateFile = path.join(targetDir, ".scaffoldix", "state.json");
      const firstState = JSON.parse(await readFile(stateFile));
      expect(firstState.lastGeneration.archetypeId).toBe("first");

      // Second generation (overwrites first - needs force)
      await handleGenerate(
        {
          ref: "regen-pack:second",
          targetDir,
          dryRun: false,
          data: { v: 2 },
          force: true,
        },
        deps
      );

      const secondState = JSON.parse(await readFile(stateFile));
      expect(secondState.lastGeneration.archetypeId).toBe("second");
      expect(secondState.lastGeneration.inputs).toEqual({ v: 2 });

      // Verify updatedAt was updated
      expect(new Date(secondState.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(firstState.updatedAt).getTime()
      );
    });
  });

  // ===========================================================================
  // Integration
  // ===========================================================================

  describe("integration", () => {
    it("full generation flow with multiple files", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "4".repeat(64);

      const registry = createRegistry([
        {
          id: "full-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/full" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "full-pack", hash, {
        archetypes: [
          {
            id: "complete",
            templateRoot: "templates",
            files: [
              { name: "README.md", content: "# {{name}}\n\n{{description}}" },
              { name: "package.json", content: '{\n  "name": "{{name}}"\n}' },
              { name: "src/main.ts", content: 'console.log("Hello, {{name}}!");' },
            ],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "full-pack:complete",
          targetDir,
          dryRun: false,
          data: {
            name: "awesome-project",
            description: "An awesome project",
          },
        },
        deps
      );

      expect(result.filesWritten.length).toBe(3);

      const readme = await readFile(path.join(targetDir, "README.md"));
      expect(readme).toContain("# awesome-project");
      expect(readme).toContain("An awesome project");

      const pkg = await readFile(path.join(targetDir, "package.json"));
      expect(pkg).toContain('"name": "awesome-project"');

      const main = await readFile(path.join(targetDir, "src/main.ts"));
      expect(main).toContain('Hello, awesome-project!');

      // Format output
      const lines = formatGenerateOutput(result);
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // handleGenerate() - Trace Integration
  // ===========================================================================

  describe("handleGenerate() - trace", () => {
    it("returns trace with major phases and durations", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "a".repeat(64);

      // Create registry
      const registry = createRegistry([
        {
          id: "trace-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/test" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack with simple template
      await createTestPack(packsDir, "trace-pack", hash, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [{ name: "index.ts", content: 'console.log("hello");' }],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "trace-pack:default",
          targetDir,
          dryRun: false,
          data: {},
        },
        deps
      );

      // Trace should be defined
      expect(result.trace).toBeDefined();

      // Trace should be an object with trace array
      const trace = result.trace!;
      expect(trace.trace).toBeInstanceOf(Array);
      expect(trace.trace.length).toBeGreaterThan(0);

      // Should contain key phases
      const phaseNames = trace.trace.map((e: { name: string }) => e.name);
      expect(phaseNames).toContain("resolve pack");
      expect(phaseNames).toContain("load manifest");
      expect(phaseNames).toContain("render templates");
      expect(phaseNames).toContain("commit staging");

      // All completed phases should have durations
      for (const entry of trace.trace) {
        if (entry.end) {
          expect(typeof entry.durationMs).toBe("number");
          expect(entry.durationMs).toBeGreaterThanOrEqual(0);
        }
      }

      // Total duration should be positive
      expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("includes trace context for key phases", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "a".repeat(64);

      const registry = createRegistry([
        {
          id: "context-pack",
          version: "2.0.0",
          origin: { type: "local", localPath: "/test" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "context-pack", hash, {
        archetypes: [
          {
            id: "service",
            templateRoot: "templates",
            files: [{ name: "app.ts", content: "export default {};" }],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "context-pack:service",
          targetDir,
          dryRun: false,
          data: {},
        },
        deps
      );

      const trace = result.trace!;

      // Find "resolve pack" phase - should have packId context
      const resolvePack = trace.trace.find((e: { name: string }) => e.name === "resolve pack");
      expect(resolvePack?.context?.packId).toBe("context-pack");

      // Find "load manifest" phase - should have packId context
      const loadManifest = trace.trace.find((e: { name: string }) => e.name === "load manifest");
      expect(loadManifest?.context?.packId).toBe("context-pack");
    });

    it("includes trace in dry-run mode", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const targetDir = trackDir(await createTestDir("target"));
      const hash = "a".repeat(64);

      const registry = createRegistry([
        {
          id: "dry-trace-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/test" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createTestPack(packsDir, "dry-trace-pack", hash, {
        archetypes: [
          {
            id: "default",
            templateRoot: "templates",
            files: [{ name: "main.ts", content: "// main" }],
          },
        ],
      });

      const result = await handleGenerate(
        {
          ref: "dry-trace-pack:default",
          targetDir,
          dryRun: true,
          data: {},
        },
        deps
      );

      expect(result.dryRun).toBe(true);
      expect(result.trace).toBeDefined();

      const phaseNames = result.trace!.trace.map((e: { name: string }) => e.name);
      expect(phaseNames).toContain("resolve pack");
      expect(phaseNames).toContain("render templates");
      // Dry-run should NOT have staging phases
      expect(phaseNames).not.toContain("commit staging");
    });
  });
});
