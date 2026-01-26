import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handleArchetypesList,
  formatArchetypesListOutput,
  type ArchetypesListDependencies,
  type ArchetypesListResult,
} from "../src/cli/handlers/archetypesListHandler.js";
import {
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
  deps: ArchetypesListDependencies;
  registryFile: string;
}> {
  const storeDir = await createTestDir("archetypes-list-test");
  const packsDir = path.join(storeDir, "packs");
  const registryFile = path.join(storeDir, "registry.json");

  await fs.mkdir(packsDir, { recursive: true });

  const deps: ArchetypesListDependencies = {
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

describe("archetypesListHandler", () => {
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
  // handleArchetypesList() - Empty Registry
  // ===========================================================================

  describe("handleArchetypesList() - empty registry", () => {
    it("returns empty list and noPacksInstalled flag when registry does not exist", async () => {
      const { storeDir, deps } = await createTestDependencies();
      trackDir(storeDir);

      const result = await handleArchetypesList(deps);

      expect(result.archetypes).toHaveLength(0);
      expect(result.noPacksInstalled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("returns empty list and noPacksInstalled flag when registry has no packs", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const registry = createRegistry([]);
      await writeRegistry(registryFile, registry);

      const result = await handleArchetypesList(deps);

      expect(result.archetypes).toHaveLength(0);
      expect(result.noPacksInstalled).toBe(true);
    });
  });

  // ===========================================================================
  // handleArchetypesList() - Multiple Valid Packs
  // ===========================================================================

  describe("handleArchetypesList() - multiple valid packs", () => {
    it("aggregates archetypes from multiple packs", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash1 = "1".repeat(64);
      const hash2 = "2".repeat(64);

      const registry = createRegistry([
        {
          id: "pack-a",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path/a" },
          hash: hash1,
        },
        {
          id: "pack-b",
          version: "2.0.0",
          origin: { type: "local", localPath: "/path/b" },
          hash: hash2,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "pack-a", hash1, ["component", "service"]);
      await createPackInStore(packsDir, "pack-b", hash2, ["api", "web"]);

      const result = await handleArchetypesList(deps);

      expect(result.archetypes).toHaveLength(4);
      expect(result.noPacksInstalled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it("outputs archetypes in packId:archetypeId format", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "a".repeat(64);
      const registry = createRegistry([
        {
          id: "my-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "my-pack", hash, ["default"]);

      const result = await handleArchetypesList(deps);

      expect(result.archetypes).toContain("my-pack:default");
    });

    it("sorts archetypes by packId then archetypeId (lexicographic)", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash1 = "1".repeat(64);
      const hash2 = "2".repeat(64);

      // Create packs with archetypes in non-sorted order
      const registry = createRegistry([
        {
          id: "zebra-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/z" },
          hash: hash1,
        },
        {
          id: "alpha-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/a" },
          hash: hash2,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "zebra-pack", hash1, ["zoo", "animal"]);
      await createPackInStore(packsDir, "alpha-pack", hash2, ["beta", "alpha"]);

      const result = await handleArchetypesList(deps);

      // Should be sorted: alpha-pack:alpha, alpha-pack:beta, zebra-pack:animal, zebra-pack:zoo
      expect(result.archetypes).toEqual([
        "alpha-pack:alpha",
        "alpha-pack:beta",
        "zebra-pack:animal",
        "zebra-pack:zoo",
      ]);
    });

    it("uses exact archetype ID from manifest (no transformation)", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "b".repeat(64);
      const registry = createRegistry([
        {
          id: "exact-ids",
          version: "1.0.0",
          origin: { type: "local", localPath: "/path" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create manifest with various ID formats
      await createPackInStore(packsDir, "exact-ids", hash, [
        "CamelCase",
        "kebab-case",
        "snake_case",
        "with.dot",
      ]);

      const result = await handleArchetypesList(deps);

      expect(result.archetypes).toContain("exact-ids:CamelCase");
      expect(result.archetypes).toContain("exact-ids:kebab-case");
      expect(result.archetypes).toContain("exact-ids:snake_case");
      expect(result.archetypes).toContain("exact-ids:with.dot");
    });
  });

  // ===========================================================================
  // handleArchetypesList() - Resilience (Invalid Packs)
  // ===========================================================================

  describe("handleArchetypesList() - resilience", () => {
    it("continues when one pack has missing storePath", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashValid = "1".repeat(64);
      const hashMissing = "2".repeat(64);

      const registry = createRegistry([
        {
          id: "valid-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/valid" },
          hash: hashValid,
        },
        {
          id: "missing-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/missing" },
          hash: hashMissing,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Only create valid-pack, not missing-pack
      await createPackInStore(packsDir, "valid-pack", hashValid, ["component"]);

      const result = await handleArchetypesList(deps);

      // Should include valid pack's archetypes
      expect(result.archetypes).toContain("valid-pack:component");
      expect(result.archetypes).toHaveLength(1);

      // Should have warning for missing pack
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("missing-pack");
      expect(result.warnings[0]).toContain("missing from store");
    });

    it("continues when one pack has invalid manifest", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashValid = "1".repeat(64);
      const hashInvalid = "2".repeat(64);

      const registry = createRegistry([
        {
          id: "valid-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/valid" },
          hash: hashValid,
        },
        {
          id: "invalid-manifest-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/invalid" },
          hash: hashInvalid,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create valid pack
      await createPackInStore(packsDir, "valid-pack", hashValid, ["component"]);

      // Create invalid pack (directory exists but manifest is invalid YAML)
      const invalidDir = path.join(
        packsDir,
        sanitizePackId("invalid-manifest-pack"),
        hashInvalid
      );
      await fs.mkdir(invalidDir, { recursive: true });
      await fs.writeFile(path.join(invalidDir, "pack.yaml"), "{ invalid: yaml: content }");

      const result = await handleArchetypesList(deps);

      // Should include valid pack's archetypes
      expect(result.archetypes).toContain("valid-pack:component");
      expect(result.archetypes).toHaveLength(1);

      // Should have warning for invalid manifest pack
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("invalid-manifest-pack");
    });

    it("continues when one pack has missing manifest", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashValid = "1".repeat(64);
      const hashNoManifest = "2".repeat(64);

      const registry = createRegistry([
        {
          id: "valid-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/valid" },
          hash: hashValid,
        },
        {
          id: "no-manifest-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/no-manifest" },
          hash: hashNoManifest,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create valid pack
      await createPackInStore(packsDir, "valid-pack", hashValid, ["component"]);

      // Create pack directory without manifest
      const noManifestDir = path.join(
        packsDir,
        sanitizePackId("no-manifest-pack"),
        hashNoManifest
      );
      await fs.mkdir(noManifestDir, { recursive: true });

      const result = await handleArchetypesList(deps);

      // Should include valid pack's archetypes
      expect(result.archetypes).toContain("valid-pack:component");
      expect(result.archetypes).toHaveLength(1);

      // Should have warning for pack without manifest
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("no-manifest-pack");
    });

    it("warning includes packId and storePath for missing directory", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "a0".repeat(32); // Valid hex: 64 chars
      const registry = createRegistry([
        {
          id: "ghost-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/ghost" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Don't create the pack directory

      const result = await handleArchetypesList(deps);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("ghost-pack");
      expect(result.warnings[0]).toContain(packsDir);
    });

    it("warning includes error summary for manifest errors", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash = "e".repeat(64);
      const registry = createRegistry([
        {
          id: "error-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/error" },
          hash,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Create pack with invalid manifest schema
      const errorDir = path.join(packsDir, sanitizePackId("error-pack"), hash);
      await fs.mkdir(errorDir, { recursive: true });
      await fs.writeFile(
        path.join(errorDir, "pack.yaml"),
        `pack:
  name: error-pack
  # Missing version
archetypes: []`
      );

      const result = await handleArchetypesList(deps);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("error-pack");
    });
  });

  // ===========================================================================
  // handleArchetypesList() - Corrupted Registry
  // ===========================================================================

  describe("handleArchetypesList() - corrupted registry", () => {
    it("throws actionable error for invalid JSON", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      // Write invalid JSON
      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(registryFile, "{ invalid json }");

      await expect(handleArchetypesList(deps)).rejects.toMatchObject({
        code: "REGISTRY_INVALID_JSON",
      });
    });

    it("error includes registry file path for corrupted registry", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(registryFile, "not valid json");

      try {
        await handleArchetypesList(deps);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details.path).toBe(registryFile);
      }
    });

    it("throws actionable error for schema mismatch", async () => {
      const { storeDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      await fs.mkdir(path.dirname(registryFile), { recursive: true });
      await fs.writeFile(
        registryFile,
        JSON.stringify({
          schemaVersion: "not a number",
          packs: {},
        })
      );

      await expect(handleArchetypesList(deps)).rejects.toMatchObject({
        code: "REGISTRY_INVALID_SCHEMA",
      });
    });
  });

  // ===========================================================================
  // formatArchetypesListOutput()
  // ===========================================================================

  describe("formatArchetypesListOutput()", () => {
    it("formats empty list with noPacksInstalled message", () => {
      const result: ArchetypesListResult = {
        archetypes: [],
        noPacksInstalled: true,
        warnings: [],
      };

      const { stdout, stderr } = formatArchetypesListOutput(result);

      expect(stdout).toHaveLength(1);
      expect(stdout[0]).toContain("No packs installed");
      expect(stdout[0]).toContain("scaffoldix pack add");
      expect(stderr).toHaveLength(0);
    });

    it("formats single archetype as one line", () => {
      const result: ArchetypesListResult = {
        archetypes: ["my-pack:default"],
        noPacksInstalled: false,
        warnings: [],
      };

      const { stdout, stderr } = formatArchetypesListOutput(result);

      expect(stdout).toEqual(["my-pack:default"]);
      expect(stderr).toHaveLength(0);
    });

    it("formats multiple archetypes as one per line", () => {
      const result: ArchetypesListResult = {
        archetypes: [
          "alpha-pack:api",
          "alpha-pack:web",
          "beta-pack:service",
        ],
        noPacksInstalled: false,
        warnings: [],
      };

      const { stdout, stderr } = formatArchetypesListOutput(result);

      expect(stdout).toEqual([
        "alpha-pack:api",
        "alpha-pack:web",
        "beta-pack:service",
      ]);
      expect(stderr).toHaveLength(0);
    });

    it("separates warnings to stderr", () => {
      const result: ArchetypesListResult = {
        archetypes: ["valid-pack:component"],
        noPacksInstalled: false,
        warnings: ["Warning: pack 'bad-pack' missing from store"],
      };

      const { stdout, stderr } = formatArchetypesListOutput(result);

      expect(stdout).toEqual(["valid-pack:component"]);
      expect(stderr).toEqual(["Warning: pack 'bad-pack' missing from store"]);
    });

    it("shows message when all packs are invalid (zero archetypes with warnings)", () => {
      const result: ArchetypesListResult = {
        archetypes: [],
        noPacksInstalled: false,
        warnings: [
          "Warning: pack 'pack-a' missing from store",
          "Warning: pack 'pack-b' has invalid manifest",
        ],
      };

      const { stdout, stderr } = formatArchetypesListOutput(result);

      // Should have message explaining why no archetypes
      expect(stdout).toHaveLength(1);
      expect(stdout[0]).toContain("No archetypes available");
      // Warnings should be in stderr
      expect(stderr).toHaveLength(2);
    });

    it("output is stable and predictable", () => {
      const result: ArchetypesListResult = {
        archetypes: ["pack-a:alpha", "pack-a:beta", "pack-b:gamma"],
        noPacksInstalled: false,
        warnings: [],
      };

      const output1 = formatArchetypesListOutput(result);
      const output2 = formatArchetypesListOutput(result);

      expect(output1).toEqual(output2);
    });
  });

  // ===========================================================================
  // Integration-style tests
  // ===========================================================================

  describe("integration", () => {
    it("full flow: multiple packs, aggregated sorted list", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hash1 = "1".repeat(64);
      const hash2 = "2".repeat(64);
      const hash3 = "3".repeat(64);

      const registry = createRegistry([
        {
          id: "react-starter",
          version: "1.0.0",
          origin: { type: "local", localPath: "/react" },
          hash: hash1,
        },
        {
          id: "api-kit",
          version: "2.0.0",
          origin: { type: "local", localPath: "/api" },
          hash: hash2,
        },
        {
          id: "shared-utils",
          version: "1.0.0",
          origin: { type: "local", localPath: "/shared" },
          hash: hash3,
        },
      ]);
      await writeRegistry(registryFile, registry);

      await createPackInStore(packsDir, "react-starter", hash1, ["component", "page", "hook"]);
      await createPackInStore(packsDir, "api-kit", hash2, ["controller", "service"]);
      await createPackInStore(packsDir, "shared-utils", hash3, ["util"]);

      const result = await handleArchetypesList(deps);

      // All archetypes aggregated
      expect(result.archetypes).toHaveLength(6);

      // Sorted by packId then archetypeId
      expect(result.archetypes).toEqual([
        "api-kit:controller",
        "api-kit:service",
        "react-starter:component",
        "react-starter:hook",
        "react-starter:page",
        "shared-utils:util",
      ]);

      // Format output
      const { stdout, stderr } = formatArchetypesListOutput(result);
      expect(stdout).toHaveLength(6);
      expect(stderr).toHaveLength(0);
    });

    it("full flow: valid + invalid packs, archetypes from valid only", async () => {
      const { storeDir, packsDir, deps, registryFile } = await createTestDependencies();
      trackDir(storeDir);

      const hashValid = "abcdef".repeat(10) + "abcd"; // 64 hex chars
      const hashMissing = "0123456789abcdef".repeat(4); // 64 hex chars
      const hashCorrupt = "fedcba9876543210".repeat(4); // 64 hex chars

      const registry = createRegistry([
        {
          id: "valid-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/valid" },
          hash: hashValid,
        },
        {
          id: "missing-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/missing" },
          hash: hashMissing,
        },
        {
          id: "corrupt-pack",
          version: "1.0.0",
          origin: { type: "local", localPath: "/corrupt" },
          hash: hashCorrupt,
        },
      ]);
      await writeRegistry(registryFile, registry);

      // Only create valid pack
      await createPackInStore(packsDir, "valid-pack", hashValid, ["good"]);

      // Create corrupt pack directory without manifest
      const corruptDir = path.join(packsDir, sanitizePackId("corrupt-pack"), hashCorrupt);
      await fs.mkdir(corruptDir, { recursive: true });

      const result = await handleArchetypesList(deps);

      // Only valid pack's archetype
      expect(result.archetypes).toEqual(["valid-pack:good"]);

      // Two warnings (missing + corrupt)
      expect(result.warnings).toHaveLength(2);

      // Format and verify
      const { stdout, stderr } = formatArchetypesListOutput(result);
      expect(stdout).toEqual(["valid-pack:good"]);
      expect(stderr).toHaveLength(2);
    });
  });
});
