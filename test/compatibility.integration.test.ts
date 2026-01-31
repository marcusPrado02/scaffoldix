/**
 * Integration tests for compatibility checking in CLI commands.
 *
 * Tests that pack add, generate, and pack info properly validate
 * compatibility constraints from pack manifests.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock CLI_VERSION before importing handlers
vi.mock("../src/cli/version.js", () => ({
  CLI_VERSION: "0.5.0", // Test with a known version
}));

import { handlePackAdd, type PackAddDependencies } from "../src/cli/handlers/packAddHandler.js";
import { ScaffoldError } from "../src/core/errors/errors.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = path.join(os.tmpdir(), "scaffoldix-compat-test");
  await fs.mkdir(baseDir, { recursive: true });
  return await fs.mkdtemp(path.join(baseDir, "test-"));
}

async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

function createManifest(options: {
  name?: string;
  version?: string;
  minVersion?: string;
  maxVersion?: string;
  incompatible?: string[];
}): string {
  const { name = "test-pack", version = "1.0.0" } = options;

  let scaffoldixSection = "";
  if (options.minVersion || options.maxVersion || options.incompatible) {
    const parts: string[] = [];
    if (options.minVersion) parts.push(`    minVersion: "${options.minVersion}"`);
    if (options.maxVersion) parts.push(`    maxVersion: "${options.maxVersion}"`);
    if (options.incompatible) {
      parts.push(`    incompatible:`);
      for (const v of options.incompatible) {
        parts.push(`      - "${v}"`);
      }
    }
    scaffoldixSection = `scaffoldix:
  compatibility:
${parts.join("\n")}
`;
  }

  return `pack:
  name: ${name}
  version: ${version}
${scaffoldixSection}archetypes:
  - id: default
    templateRoot: templates
`;
}

function createMockDeps(storeDir: string): PackAddDependencies {
  return {
    storeConfig: {
      storeDir,
      registryFile: path.join(storeDir, "registry.json"),
      packsDir: path.join(storeDir, "packs"),
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("Compatibility integration", () => {
  let tempDir: string;
  let packDir: string;
  let storeDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    packDir = path.join(tempDir, "pack");
    storeDir = path.join(tempDir, "store");
    await fs.mkdir(packDir, { recursive: true });
    await fs.mkdir(path.join(packDir, "templates"), { recursive: true });
    await fs.mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    vi.clearAllMocks();
  });

  describe("pack add with compatibility", () => {
    it("succeeds when no compatibility section exists (backward compatible)", async () => {
      await fs.writeFile(path.join(packDir, "archetype.yaml"), createManifest({}));

      const result = await handlePackAdd(
        { packPath: packDir, cwd: tempDir },
        createMockDeps(storeDir)
      );

      expect(result.status).toBe("installed");
    });

    it("succeeds when CLI version is within range", async () => {
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifest({ minVersion: "0.2.0", maxVersion: "1.0.0" })
      );

      const result = await handlePackAdd(
        { packPath: packDir, cwd: tempDir },
        createMockDeps(storeDir)
      );

      expect(result.status).toBe("installed");
    });

    it("throws when CLI version is below minVersion", async () => {
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifest({ minVersion: "1.0.0" }) // CLI is 0.5.0, below this
      );

      await expect(
        handlePackAdd({ packPath: packDir, cwd: tempDir }, createMockDeps(storeDir))
      ).rejects.toThrow(ScaffoldError);

      try {
        await handlePackAdd({ packPath: packDir, cwd: tempDir }, createMockDeps(storeDir));
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PACK_INCOMPATIBLE");
        expect(scaffoldErr.hint).toContain("1.0.0"); // Constraint version in hint
        expect(scaffoldErr.hint).toContain("upgrade");
      }
    });

    it("throws when CLI version is above maxVersion", async () => {
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifest({ maxVersion: "0.4.0" }) // CLI is 0.5.0, above this
      );

      try {
        await handlePackAdd({ packPath: packDir, cwd: tempDir }, createMockDeps(storeDir));
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PACK_INCOMPATIBLE");
        expect(scaffoldErr.hint).toContain("0.4.0"); // Constraint version in hint
      }
    });

    it("throws when CLI version is in incompatible list", async () => {
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifest({ incompatible: ["0.5.0", "0.6.0"] }) // CLI is 0.5.0
      );

      try {
        await handlePackAdd({ packPath: packDir, cwd: tempDir }, createMockDeps(storeDir));
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ScaffoldError);
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.code).toBe("PACK_INCOMPATIBLE");
        expect(scaffoldErr.hint).toContain("0.5.0"); // CLI version in hint
      }
    });

    it("error includes pack information", async () => {
      await fs.writeFile(
        path.join(packDir, "archetype.yaml"),
        createManifest({ name: "my-pack", version: "2.0.0", minVersion: "1.0.0" })
      );

      try {
        await handlePackAdd({ packPath: packDir, cwd: tempDir }, createMockDeps(storeDir));
        expect.fail("Should have thrown");
      } catch (err) {
        const scaffoldErr = err as ScaffoldError;
        expect(scaffoldErr.details?.packId).toBe("my-pack");
        expect(scaffoldErr.details?.packVersion).toBe("2.0.0");
        expect(scaffoldErr.details?.cliVersion).toBe("0.5.0");
      }
    });
  });
});
