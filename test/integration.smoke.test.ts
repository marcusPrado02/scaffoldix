/**
 * MVP v0.1 Smoke/Integration Test.
 *
 * This test exercises the full "golden path" end-to-end:
 * 1. pack add <path>
 * 2. pack list
 * 3. generate <packId>:<archetypeId> --target <dir>
 *
 * Validates:
 * - Pack is installed into internal store (copy exists)
 * - registry.json is updated correctly
 * - Generated files exist and content is correct
 * - .scaffoldix/state.json exists with correct metadata
 *
 * This test is HERMETIC: it uses temp directories and dependency injection,
 * never touching the real user environment paths.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Handler imports
import {
  handlePackAdd,
  type PackAddInput,
  type PackAddDependencies,
} from "../src/cli/handlers/packAddHandler.js";
import {
  handlePackList,
  formatPackListOutput,
  type PackListDependencies,
} from "../src/cli/handlers/packListHandler.js";
import {
  handleGenerate,
  type GenerateInput,
  type GenerateDependencies,
} from "../src/cli/handlers/generateHandler.js";

// Service imports for dependency injection
import type { StoreServiceConfig, StoreLogger } from "../src/core/store/StoreService.js";

// Type imports for assertions
import type { Registry } from "../src/core/registry/RegistryService.js";
import type { ProjectState } from "../src/core/state/ProjectStateManager.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a no-op logger for testing.
 */
function createTestLogger(): StoreLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}

/**
 * Creates a hermetic test workspace with isolated store and target directories.
 */
async function createTestWorkspace(): Promise<{
  workspaceDir: string;
  storeDir: string;
  packsDir: string;
  registryFile: string;
  targetDir: string;
  storeConfig: StoreServiceConfig;
  logger: StoreLogger;
}> {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "scaffoldix-smoke-test-")
  );

  const storeDir = path.join(workspaceDir, "store");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");
  const targetDir = path.join(workspaceDir, "target");

  await fs.mkdir(packsDir, { recursive: true });
  await fs.mkdir(targetDir, { recursive: true });

  const storeConfig: StoreServiceConfig = {
    storeDir,
    packsDir,
    registryFile,
  };

  const logger = createTestLogger();

  return { workspaceDir, storeDir, packsDir, registryFile, targetDir, storeConfig, logger };
}

/**
 * Cleans up the test workspace.
 */
async function cleanupWorkspace(workspaceDir: string): Promise<void> {
  try {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Gets the path to the example-pack fixture.
 */
function getExamplePackPath(): string {
  return path.join(__dirname, "fixtures", "example-pack");
}

/**
 * Reads and parses a JSON file.
 */
async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Checks if a path exists.
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Smoke Test
// =============================================================================

describe("MVP v0.1 Smoke Test", () => {
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    workspace = await createTestWorkspace();
  });

  afterEach(async () => {
    if (workspace) {
      await cleanupWorkspace(workspace.workspaceDir);
    }
  });

  it("smoke: mvp golden path pack add -> list -> generate", async () => {
    const { packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
    const examplePackPath = getExamplePackPath();

    // =========================================================================
    // Step A: pack add
    // =========================================================================

    const packAddInput: PackAddInput = {
      packPath: examplePackPath,
      cwd: process.cwd(),
    };

    const packAddDeps: PackAddDependencies = {
      storeConfig,
      logger,
    };

    const addResult = await handlePackAdd(packAddInput, packAddDeps);

    // Assert: install succeeded with correct identity
    expect(addResult.packId, "Pack ID should be 'example-pack'").toBe("example-pack");
    expect(addResult.version, "Pack version should be '1.0.0'").toBe("1.0.0");
    expect(addResult.hash, "Hash should be a 64-char hex string").toMatch(/^[a-f0-9]{64}$/);
    expect(addResult.status, "Status should be 'installed' or 'already_installed'").toMatch(
      /^(installed|already_installed)$/
    );

    // Assert: store contains intact copy of the pack
    const expectedStorePath = path.join(packsDir, "example-pack", addResult.hash);
    expect(
      await pathExists(expectedStorePath),
      `Store path should exist: ${expectedStorePath}`
    ).toBe(true);

    // Verify pack.yaml was copied
    const storedManifest = path.join(expectedStorePath, "pack.yaml");
    expect(
      await pathExists(storedManifest),
      `Manifest should exist in store: ${storedManifest}`
    ).toBe(true);

    // Verify templates were copied
    const storedTemplate = path.join(expectedStorePath, "templates", "hello", "README.md");
    expect(
      await pathExists(storedTemplate),
      `Template should exist in store: ${storedTemplate}`
    ).toBe(true);

    // Assert: registry.json exists and is correct
    expect(
      await pathExists(registryFile),
      `Registry file should exist: ${registryFile}`
    ).toBe(true);

    const registry = await readJson<Registry>(registryFile);

    expect(registry.schemaVersion, "Registry should have schemaVersion").toBeDefined();
    expect(registry.packs["example-pack"], "Registry should contain example-pack").toBeDefined();

    const packEntry = registry.packs["example-pack"];
    expect(packEntry.id).toBe("example-pack");
    expect(packEntry.version).toBe("1.0.0");
    expect(packEntry.hash).toBe(addResult.hash);
    expect(packEntry.origin.type).toBe("local");
    expect(packEntry.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp

    // =========================================================================
    // Step B: pack list
    // =========================================================================

    const packListDeps: PackListDependencies = {
      registryFile,
    };

    const listResult = await handlePackList(packListDeps);

    // Assert: list contains the installed pack
    expect(listResult.packs.length, "Should have 1 pack installed").toBe(1);
    expect(listResult.packs[0].packId).toBe("example-pack");
    expect(listResult.packs[0].version).toBe("1.0.0");

    // Verify formatted output contains expected info
    const formattedOutput = formatPackListOutput(listResult);
    const outputText = formattedOutput.join("\n");
    expect(outputText, "Output should contain pack ID").toContain("example-pack");
    expect(outputText, "Output should contain version").toContain("1.0.0");

    // =========================================================================
    // Step C: generate
    // =========================================================================

    const generateInput: GenerateInput = {
      ref: "example-pack:hello",
      targetDir,
      dryRun: false,
      data: {
        name: "Marcus",
        entity: "User",
      },
      renameRules: {
        replacements: {
          __Entity__: "User",
        },
      },
    };

    const generateDeps: GenerateDependencies = {
      registryFile,
      packsDir,
    };

    const genResult = await handleGenerate(generateInput, generateDeps);

    // Assert: generation succeeded
    expect(genResult.packId).toBe("example-pack");
    expect(genResult.archetypeId).toBe("hello");
    expect(genResult.dryRun).toBe(false);
    expect(genResult.filesWritten.length, "Should have written files").toBeGreaterThan(0);

    // Assert: README.md exists and content is rendered
    const readmePath = path.join(targetDir, "README.md");
    expect(
      await pathExists(readmePath),
      `README.md should exist: ${readmePath}`
    ).toBe(true);

    const readmeContent = await fs.readFile(readmePath, "utf-8");
    expect(readmeContent, "README should contain rendered name").toContain("Hello Marcus");
    expect(readmeContent, "README should contain welcome message").toContain(
      "Welcome to your new project, Marcus!"
    );

    // Assert: Renamed directory exists (via rename rules)
    const userDirPath = path.join(targetDir, "User");
    expect(
      await pathExists(userDirPath),
      `Renamed directory should exist: ${userDirPath}`
    ).toBe(true);

    // Assert: Renamed service file exists with rendered content
    const userServicePath = path.join(targetDir, "User", "UserService.ts");
    expect(
      await pathExists(userServicePath),
      `Renamed service file should exist: ${userServicePath}`
    ).toBe(true);

    const serviceContent = await fs.readFile(userServicePath, "utf-8");
    expect(serviceContent, "Service should contain rendered class name").toContain(
      "class UserService"
    );
    expect(serviceContent, "Service should contain rendered interface").toContain(
      "interface User"
    );

    // =========================================================================
    // Step D: state validation
    // =========================================================================

    const stateFilePath = path.join(targetDir, ".scaffoldix", "state.json");
    expect(
      await pathExists(stateFilePath),
      `.scaffoldix/state.json should exist: ${stateFilePath}`
    ).toBe(true);

    const state = await readJson<ProjectState>(stateFilePath);

    // Assert: schema version
    expect(state.schemaVersion, "State should have schemaVersion").toBe(1);

    // Assert: lastGeneration fields
    expect(state.lastGeneration, "State should have lastGeneration").toBeDefined();
    expect(state.lastGeneration.packId).toBe("example-pack");
    expect(state.lastGeneration.packVersion).toBe("1.0.0");
    expect(state.lastGeneration.archetypeId).toBe("hello");

    // Assert: inputs match what was used
    expect(state.lastGeneration.inputs).toEqual({
      name: "Marcus",
      entity: "User",
    });

    // Assert: timestamps are valid ISO strings
    expect(state.updatedAt, "updatedAt should be ISO string").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
    expect(state.lastGeneration.timestamp, "timestamp should be ISO string").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );

    // =========================================================================
    // Success!
    // =========================================================================
    // If we got here, the entire MVP golden path works correctly.
  });

  it("smoke: pack add -> generate without rename rules uses raw filenames", async () => {
    const { packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
    const examplePackPath = getExamplePackPath();

    // Add the pack
    await handlePackAdd(
      { packPath: examplePackPath, cwd: process.cwd() },
      { storeConfig, logger }
    );

    // Generate WITHOUT rename rules
    const genResult = await handleGenerate(
      {
        ref: "example-pack:hello",
        targetDir,
        dryRun: false,
        data: { name: "Test", entity: "Item" },
        // No renameRules provided
      },
      { registryFile, packsDir }
    );

    expect(genResult.filesWritten.length).toBeGreaterThan(0);

    // Without rename rules, the __Entity__ directory should exist as-is
    const entityDirPath = path.join(targetDir, "__Entity__");
    expect(
      await pathExists(entityDirPath),
      `__Entity__ directory should exist without rename rules: ${entityDirPath}`
    ).toBe(true);

    // Content should still be rendered
    const servicePath = path.join(targetDir, "__Entity__", "__Entity__Service.ts");
    const content = await fs.readFile(servicePath, "utf-8");
    expect(content).toContain("class ItemService");
  });

  it("smoke: dry-run does not write files or state", async () => {
    const { packsDir, registryFile, targetDir, storeConfig, logger } = workspace;
    const examplePackPath = getExamplePackPath();

    // Add the pack
    await handlePackAdd(
      { packPath: examplePackPath, cwd: process.cwd() },
      { storeConfig, logger }
    );

    // Generate with dry-run
    const genResult = await handleGenerate(
      {
        ref: "example-pack:hello",
        targetDir,
        dryRun: true,
        data: { name: "DryRun" },
      },
      { registryFile, packsDir }
    );

    // Assert: dry-run results
    expect(genResult.dryRun).toBe(true);
    expect(genResult.filesPlanned.length).toBeGreaterThan(0);
    expect(genResult.filesWritten.length).toBe(0);

    // Assert: target dir should be empty (no files written)
    const targetFiles = await fs.readdir(targetDir);
    expect(targetFiles.length, "Target dir should be empty on dry-run").toBe(0);

    // Assert: no state file created
    const stateFilePath = path.join(targetDir, ".scaffoldix", "state.json");
    expect(
      await pathExists(stateFilePath),
      "State file should NOT exist on dry-run"
    ).toBe(false);
  });
});
