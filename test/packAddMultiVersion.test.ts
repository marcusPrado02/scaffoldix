/**
 * Tests for multi-version pack add behavior.
 *
 * When adding a pack that already exists with a different version,
 * both versions should be preserved in the registry's installs[] array.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  handlePackAdd,
  type PackAddDependencies,
} from "../src/cli/handlers/packAddHandler.js";
import { RegistryService } from "../src/core/registry/RegistryService.js";
import { PackResolver } from "../src/core/store/PackResolver.js";
import { type StoreLogger } from "../src/core/store/StoreService.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `scaffoldix-${prefix}-`));
}

async function cleanupTestDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

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

async function createTestPack(
  baseDir: string,
  name: string,
  version: string,
  extraContent?: string
): Promise<string> {
  const packDir = path.join(baseDir, `${name.replace("/", "__")}-${version}`);
  await fs.mkdir(packDir, { recursive: true });

  await fs.writeFile(path.join(packDir, "archetype.yaml"), createManifestYaml(name, version));

  const templateDir = path.join(packDir, "templates", "default");
  await fs.mkdir(templateDir, { recursive: true });
  // Add version-specific content so hashes differ
  await fs.writeFile(
    path.join(templateDir, "README.md"),
    `# ${name} v${version}\n${extraContent ?? ""}\n`
  );

  return packDir;
}

async function createTestDependencies(): Promise<{
  storeDir: string;
  deps: PackAddDependencies;
}> {
  const storeDir = await createTestDir("store-multiversion");
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

  return { storeDir, deps };
}

// =============================================================================
// Tests
// =============================================================================

describe("pack add multi-version", () => {
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

  it("preserves existing version when adding a new version of the same pack", async () => {
    const sourceDir = trackDir(await createTestDir("source"));
    const { storeDir, deps } = await createTestDependencies();
    trackDir(storeDir);

    // Add v1
    const packV1 = await createTestPack(sourceDir, "my-pack", "1.0.0", "version 1 content");
    const result1 = await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);
    expect(result1.status).toBe("installed");
    expect(result1.version).toBe("1.0.0");

    // Add v2 (different version of same pack)
    const packV2 = await createTestPack(sourceDir, "my-pack", "2.0.0", "version 2 content");
    const result2 = await handlePackAdd({ packPath: packV2, cwd: "/tmp" }, deps);
    expect(result2.status).toBe("installed");
    expect(result2.version).toBe("2.0.0");

    // Registry should have installs array with both versions
    const registry = new RegistryService(deps.storeConfig.registryFile);
    const installs = await registry.getPackInstalls("my-pack");

    expect(installs).toHaveLength(2);
    const versions = installs!.map((i) => i.version).sort();
    expect(versions).toEqual(["1.0.0", "2.0.0"]);
  });

  it("both versions are resolvable via PackResolver", async () => {
    const sourceDir = trackDir(await createTestDir("source"));
    const { storeDir, deps } = await createTestDependencies();
    trackDir(storeDir);

    // Add v1 and v2
    const packV1 = await createTestPack(sourceDir, "resolvable-pack", "1.0.0", "v1");
    await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);

    const packV2 = await createTestPack(sourceDir, "resolvable-pack", "2.0.0", "v2");
    await handlePackAdd({ packPath: packV2, cwd: "/tmp" }, deps);

    // Resolve versions
    const resolver = new PackResolver(deps.storeConfig.registryFile);

    const v1 = await resolver.resolve("resolvable-pack", "1.0.0");
    expect(v1.version).toBe("1.0.0");

    const v2 = await resolver.resolve("resolvable-pack", "2.0.0");
    expect(v2.version).toBe("2.0.0");

    // Latest should be v2
    const latest = await resolver.resolve("resolvable-pack");
    expect(latest.version).toBe("2.0.0");
  });

  it("both version directories exist in the store", async () => {
    const sourceDir = trackDir(await createTestDir("source"));
    const { storeDir, deps } = await createTestDependencies();
    trackDir(storeDir);

    const packV1 = await createTestPack(sourceDir, "store-check", "1.0.0", "v1");
    const result1 = await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);

    const packV2 = await createTestPack(sourceDir, "store-check", "2.0.0", "v2");
    const result2 = await handlePackAdd({ packPath: packV2, cwd: "/tmp" }, deps);

    // Both destDirs should exist
    const v1Exists = await fs.access(result1.destDir).then(() => true).catch(() => false);
    const v2Exists = await fs.access(result2.destDir).then(() => true).catch(() => false);

    expect(v1Exists).toBe(true);
    expect(v2Exists).toBe(true);
    expect(result1.destDir).not.toBe(result2.destDir); // Different hashes
  });

  it("adding same version twice does not duplicate installs", async () => {
    const sourceDir = trackDir(await createTestDir("source"));
    const { storeDir, deps } = await createTestDependencies();
    trackDir(storeDir);

    const packV1 = await createTestPack(sourceDir, "no-dup", "1.0.0", "same content");
    await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);

    // Add same version again
    const result2 = await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);
    expect(result2.status).toBe("already_installed");

    const registry = new RegistryService(deps.storeConfig.registryFile);
    const installs = await registry.getPackInstalls("no-dup");

    // Should still only have 1 install
    expect(installs).toHaveLength(1);
  });

  it("supports three or more versions", async () => {
    const sourceDir = trackDir(await createTestDir("source"));
    const { storeDir, deps } = await createTestDependencies();
    trackDir(storeDir);

    const packV1 = await createTestPack(sourceDir, "multi", "1.0.0", "v1 content");
    const packV2 = await createTestPack(sourceDir, "multi", "2.0.0", "v2 content");
    const packV3 = await createTestPack(sourceDir, "multi", "3.0.0", "v3 content");

    await handlePackAdd({ packPath: packV1, cwd: "/tmp" }, deps);
    await handlePackAdd({ packPath: packV2, cwd: "/tmp" }, deps);
    await handlePackAdd({ packPath: packV3, cwd: "/tmp" }, deps);

    const resolver = new PackResolver(deps.storeConfig.registryFile);
    const versions = await resolver.listVersions("multi");
    expect(versions).toEqual(["3.0.0", "2.0.0", "1.0.0"]);
  });
});
