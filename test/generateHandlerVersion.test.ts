/**
 * Tests for generate handler with --version flag.
 *
 * Verifies that the generate handler can select a specific version
 * of a multi-version pack via the version option.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { handleGenerate, type GenerateDependencies } from "../src/cli/handlers/generateHandler.js";
import { REGISTRY_SCHEMA_VERSION, type Registry } from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-genver-${prefix}-`));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function sanitizePackId(packId: string): string {
  return packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
}

/**
 * Creates a test pack in the store directory with version-specific templates.
 */
async function createVersionedTestPack(
  packsDir: string,
  packId: string,
  version: string,
  hash: string,
  templateContent: string,
): Promise<string> {
  const sanitizedId = sanitizePackId(packId);
  const packDir = path.join(packsDir, sanitizedId, hash);
  await fs.mkdir(packDir, { recursive: true });

  // Create manifest
  const quotedName = packId.startsWith("@") ? `"${packId}"` : packId;
  const manifest = `pack:
  name: ${quotedName}
  version: "${version}"
archetypes:
  - id: default
    templateRoot: templates/default
`;
  await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

  // Create template directory and file
  const templateDir = path.join(packDir, "templates", "default");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(path.join(templateDir, "index.ts"), templateContent);

  return packDir;
}

/**
 * Creates a registry with multi-version installs for a pack.
 */
function createMultiVersionRegistry(
  packId: string,
  versions: Array<{ version: string; hash: string }>,
): Registry {
  const installs = versions.map((v) => ({
    version: v.version,
    origin: { type: "local" as const, localPath: `/source/${packId}-${v.version}` },
    hash: v.hash,
    installedAt: "2024-01-15T10:30:00.000Z",
  }));

  // Top-level entry is the latest version (last in array)
  const latest = versions[versions.length - 1];

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packs: {
      [packId]: {
        id: packId,
        version: latest.version,
        origin: { type: "local", localPath: `/source/${packId}-${latest.version}` },
        hash: latest.hash,
        installedAt: "2024-01-15T10:30:00.000Z",
        installs,
      },
    },
  };
}

async function writeRegistry(registryFile: string, registry: Registry): Promise<void> {
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2));
}

// =============================================================================
// Tests
// =============================================================================

describe("generate with --version", () => {
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

  it("generates from the latest version when no version specified", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    const targetDir = trackDir(await createTestDir("target"));
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);

    // Create both versions in store
    await createVersionedTestPack(packsDir, "my-pack", "1.0.0", hashV1, "// v1\n");
    await createVersionedTestPack(packsDir, "my-pack", "2.0.0", hashV2, "// v2\n");

    // Registry with multi-version
    const registry = createMultiVersionRegistry("my-pack", [
      { version: "1.0.0", hash: hashV1 },
      { version: "2.0.0", hash: hashV2 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: GenerateDependencies = { registryFile, packsDir, storeDir };
    const result = await handleGenerate(
      { ref: "my-pack:default", targetDir, dryRun: true, data: {} },
      deps,
    );

    expect(result.packId).toBe("my-pack");
    // Should use latest (v2)
    expect(result.filesPlanned.length).toBeGreaterThan(0);
  });

  it("generates from specific version when --version is provided", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    const targetDir = trackDir(await createTestDir("target"));
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);

    // Create both versions in store with DIFFERENT content
    await createVersionedTestPack(packsDir, "versioned-pack", "1.0.0", hashV1, "// v1 specific\n");
    await createVersionedTestPack(packsDir, "versioned-pack", "2.0.0", hashV2, "// v2 specific\n");

    const registry = createMultiVersionRegistry("versioned-pack", [
      { version: "1.0.0", hash: hashV1 },
      { version: "2.0.0", hash: hashV2 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: GenerateDependencies = { registryFile, packsDir, storeDir };

    // Request v1 specifically
    const result = await handleGenerate(
      { ref: "versioned-pack:default", targetDir, dryRun: false, data: {}, version: "1.0.0" },
      deps,
    );

    expect(result.packId).toBe("versioned-pack");

    // Read generated file to verify v1 content was used
    const content = await fs.readFile(path.join(targetDir, "index.ts"), "utf-8");
    expect(content).toContain("v1 specific");
  });

  it("throws VERSION_NOT_FOUND for non-existent version", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    const targetDir = trackDir(await createTestDir("target"));
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    await createVersionedTestPack(packsDir, "only-v1", "1.0.0", hashV1, "// v1\n");

    const registry = createMultiVersionRegistry("only-v1", [{ version: "1.0.0", hash: hashV1 }]);
    await writeRegistry(registryFile, registry);

    const deps: GenerateDependencies = { registryFile, packsDir, storeDir };

    await expect(
      handleGenerate(
        { ref: "only-v1:default", targetDir, dryRun: true, data: {}, version: "9.9.9" },
        deps,
      ),
    ).rejects.toMatchObject({
      code: "VERSION_NOT_FOUND",
      hint: expect.stringContaining("1.0.0"),
    });
  });
});
