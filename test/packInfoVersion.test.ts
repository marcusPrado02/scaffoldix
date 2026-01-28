/**
 * Tests for pack info handler with --version flag.
 *
 * Verifies that pack info can display details for a specific version
 * of a multi-version pack.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackInfo,
  formatPackInfoOutput,
  type PackInfoDependencies,
} from "../src/cli/handlers/packInfoHandler.js";
import {
  REGISTRY_SCHEMA_VERSION,
  type Registry,
} from "../src/core/registry/RegistryService.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-infover-${prefix}-`));
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

async function createVersionedPack(
  packsDir: string,
  packId: string,
  version: string,
  hash: string,
  archetypes: string[] = ["default"]
): Promise<void> {
  const sanitizedId = sanitizePackId(packId);
  const packDir = path.join(packsDir, sanitizedId, hash);
  await fs.mkdir(packDir, { recursive: true });

  const quotedName = packId.startsWith("@") ? `"${packId}"` : packId;
  const archetypesList = archetypes
    .map((a) => `  - id: ${a}\n    templateRoot: templates/${a}`)
    .join("\n");

  const manifest = `pack:
  name: ${quotedName}
  version: "${version}"
archetypes:
${archetypesList}
`;
  await fs.writeFile(path.join(packDir, "pack.yaml"), manifest);

  // Create template directories
  for (const arch of archetypes) {
    const templateDir = path.join(packDir, "templates", arch);
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, "README.md"), `# ${packId} ${arch}\n`);
  }
}

function createMultiVersionRegistry(
  packId: string,
  versions: Array<{ version: string; hash: string; archetypes?: string[] }>
): Registry {
  const installs = versions.map((v) => ({
    version: v.version,
    origin: { type: "local" as const, localPath: `/source/${packId}-${v.version}` },
    hash: v.hash,
    installedAt: "2024-01-15T10:30:00.000Z",
  }));

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

describe("pack info with --version", () => {
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

  it("shows info for specific version when --version is provided", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);

    // Create both versions in store (v1 has "default", v2 has "default" + "component")
    await createVersionedPack(packsDir, "info-pack", "1.0.0", hashV1, ["default"]);
    await createVersionedPack(packsDir, "info-pack", "2.0.0", hashV2, ["default", "component"]);

    const registry = createMultiVersionRegistry("info-pack", [
      { version: "1.0.0", hash: hashV1 },
      { version: "2.0.0", hash: hashV2 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: PackInfoDependencies = { registryFile, packsDir };

    // Request v1 info
    const result = await handlePackInfo(
      { packId: "info-pack", version: "1.0.0" },
      deps
    );

    expect(result.version).toBe("1.0.0");
    expect(result.hash).toBe(hashV1);
    expect(result.archetypes).toEqual(["default"]);
  });

  it("shows info for latest version when no --version provided", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);

    await createVersionedPack(packsDir, "latest-pack", "1.0.0", hashV1, ["default"]);
    await createVersionedPack(packsDir, "latest-pack", "2.0.0", hashV2, ["default", "component"]);

    const registry = createMultiVersionRegistry("latest-pack", [
      { version: "1.0.0", hash: hashV1 },
      { version: "2.0.0", hash: hashV2 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: PackInfoDependencies = { registryFile, packsDir };

    const result = await handlePackInfo({ packId: "latest-pack" }, deps);

    // Should get latest (v2)
    expect(result.version).toBe("2.0.0");
    expect(result.hash).toBe(hashV2);
    expect(result.archetypes).toEqual(["component", "default"]); // sorted
  });

  it("throws VERSION_NOT_FOUND for non-existent version", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    await createVersionedPack(packsDir, "only-one", "1.0.0", hashV1);

    const registry = createMultiVersionRegistry("only-one", [
      { version: "1.0.0", hash: hashV1 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: PackInfoDependencies = { registryFile, packsDir };

    await expect(
      handlePackInfo({ packId: "only-one", version: "5.0.0" }, deps)
    ).rejects.toMatchObject({
      code: "VERSION_NOT_FOUND",
      hint: expect.stringContaining("1.0.0"),
    });
  });

  it("includes available versions in formatted output", async () => {
    const storeDir = trackDir(await createTestDir("store"));
    const packsDir = path.join(storeDir, "packs");
    const registryFile = path.join(storeDir, "registry.json");
    await fs.mkdir(packsDir, { recursive: true });

    const hashV1 = "a".repeat(64);
    const hashV2 = "b".repeat(64);

    await createVersionedPack(packsDir, "format-pack", "1.0.0", hashV1);
    await createVersionedPack(packsDir, "format-pack", "2.0.0", hashV2);

    const registry = createMultiVersionRegistry("format-pack", [
      { version: "1.0.0", hash: hashV1 },
      { version: "2.0.0", hash: hashV2 },
    ]);
    await writeRegistry(registryFile, registry);

    const deps: PackInfoDependencies = { registryFile, packsDir };

    const result = await handlePackInfo(
      { packId: "format-pack", version: "1.0.0" },
      deps
    );

    // availableVersions should be populated for multi-version packs
    const output = formatPackInfoOutput(result);
    const outputStr = output.join("\n");
    expect(outputStr).toContain("format-pack");
    expect(outputStr).toContain("1.0.0");
  });
});
