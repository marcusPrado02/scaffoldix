import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ManifestLoader, loadManifest } from "../ManifestLoader.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temp directory for each test.
 */
async function createTestDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "scaffoldix-manifest-test-"));
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
 * Creates a valid minimal manifest YAML string.
 */
function createValidManifest(overrides: {
  packName?: string;
  packVersion?: string;
  archetypes?: Array<{ id?: string; templateRoot?: string }>;
} = {}): string {
  const packName = overrides.packName ?? "test-pack";
  const packVersion = overrides.packVersion ?? "1.0.0";
  const archetypes = overrides.archetypes ?? [{ id: "default", templateRoot: "templates" }];

  const archetypeYaml = archetypes
    .map((a) => {
      const parts = [];
      if (a.id !== undefined) parts.push(`    id: ${a.id}`);
      if (a.templateRoot !== undefined) parts.push(`    templateRoot: ${a.templateRoot}`);
      return `  -\n${parts.join("\n")}`;
    })
    .join("\n");

  return `pack:
  name: ${packName}
  version: ${packVersion}
archetypes:
${archetypeYaml}
`;
}

/**
 * Writes a manifest file to the given directory.
 */
async function writeManifest(
  dir: string,
  content: string,
  filename: string = "archetype.yaml"
): Promise<string> {
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

// =============================================================================
// Tests
// =============================================================================

describe("ManifestLoader", () => {
  let testDir: string;
  let loader: ManifestLoader;

  beforeEach(async () => {
    testDir = await createTestDir();
    loader = new ManifestLoader();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  // ===========================================================================
  // Valid Manifest Loading
  // ===========================================================================

  describe("valid manifest loading", () => {
    it("loads valid manifest from archetype.yaml", async () => {
      await writeManifest(testDir, createValidManifest({ packName: "my-pack" }));

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("my-pack");
      expect(manifest.pack.version).toBe("1.0.0");
      expect(manifest.archetypes).toHaveLength(1);
      expect(manifest.archetypes[0].id).toBe("default");
      expect(manifest.archetypes[0].templateRoot).toBe("templates");
    });

    it("loads valid manifest from pack.yaml when archetype.yaml missing", async () => {
      await writeManifest(testDir, createValidManifest({ packName: "pack-yaml-pack" }), "pack.yaml");

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("pack-yaml-pack");
      expect(manifest.manifestPath).toContain("pack.yaml");
    });

    it("prefers archetype.yaml over pack.yaml when both exist", async () => {
      await writeManifest(testDir, createValidManifest({ packName: "from-archetype" }), "archetype.yaml");
      await writeManifest(testDir, createValidManifest({ packName: "from-pack" }), "pack.yaml");

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("from-archetype");
      expect(manifest.manifestPath).toContain("archetype.yaml");
    });

    it("returns manifestPath pointing to the loaded file", async () => {
      const filePath = await writeManifest(testDir, createValidManifest());

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.manifestPath).toBe(filePath);
    });

    it("returns packRootDir as provided", async () => {
      await writeManifest(testDir, createValidManifest());

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.packRootDir).toBe(testDir);
    });

    it("loads manifest with multiple archetypes", async () => {
      const yaml = `pack:
  name: multi-arch
  version: 2.0.0
archetypes:
  - id: minimal
    templateRoot: templates/minimal
  - id: full
    templateRoot: templates/full
  - id: advanced
    templateRoot: templates/advanced
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes).toHaveLength(3);
      expect(manifest.archetypes[0].id).toBe("minimal");
      expect(manifest.archetypes[1].id).toBe("full");
      expect(manifest.archetypes[2].id).toBe("advanced");
    });

    it("trims whitespace from string fields", async () => {
      const yaml = `pack:
  name: "  trimmed-name  "
  version: "  1.0.0  "
archetypes:
  - id: "  trimmed-id  "
    templateRoot: "  trimmed/path  "
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("trimmed-name");
      expect(manifest.pack.version).toBe("1.0.0");
      expect(manifest.archetypes[0].id).toBe("trimmed-id");
      expect(manifest.archetypes[0].templateRoot).toBe("trimmed/path");
    });
  });

  // ===========================================================================
  // Manifest Not Found
  // ===========================================================================

  describe("manifest not found", () => {
    it("throws when no manifest file exists", async () => {
      await expect(loader.loadFromDir(testDir)).rejects.toThrow(/manifest not found/i);
    });

    it("error includes packRootDir", async () => {
      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { packRootDir?: string }; hint?: string };
        expect(err.details?.packRootDir).toBe(testDir);
      }
    });

    it("error includes expected filenames", async () => {
      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { expectedFiles?: string[] }; hint?: string };
        expect(err.details?.expectedFiles).toContain("archetype.yaml");
        expect(err.details?.expectedFiles).toContain("pack.yaml");
      }
    });

    it("error includes actionable guidance", async () => {
      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { hint?: string };
        expect(err.hint).toMatch(/create archetype\.yaml or pack\.yaml/i);
      }
    });

    it("error has correct error code", async () => {
      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_NOT_FOUND");
      }
    });
  });

  // ===========================================================================
  // Invalid YAML
  // ===========================================================================

  describe("invalid YAML syntax", () => {
    it("throws on syntactically invalid YAML", async () => {
      await writeManifest(testDir, `
pack:
  name: test
  version: 1.0.0
archetypes:
  - id: broken
    templateRoot: [[[invalid yaml
`);

      await expect(loader.loadFromDir(testDir)).rejects.toThrow(/yaml/i);
    });

    it("error includes manifest filename", async () => {
      await writeManifest(testDir, "invalid: yaml: content: [[[");

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { manifestPath?: string } };
        expect(err.details?.manifestPath).toContain("archetype.yaml");
      }
    });

    it("error has YAML error code", async () => {
      // Use content that truly fails YAML parsing (unmatched brackets)
      await writeManifest(testDir, "key: [[[unclosed");

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_YAML_ERROR");
      }
    });

    it("throws on indentation errors", async () => {
      await writeManifest(testDir, `
pack:
name: bad-indent
  version: 1.0.0
`);

      await expect(loader.loadFromDir(testDir)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Schema Validation: Missing Fields
  // ===========================================================================

  describe("schema validation - missing fields", () => {
    it("throws when pack object is missing", async () => {
      await writeManifest(testDir, `
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path === "pack")).toBe(true);
      }
    });

    it("throws when pack.name is missing", async () => {
      await writeManifest(testDir, `
pack:
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("name"))).toBe(true);
      }
    });

    it("throws when pack.version is missing", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("version"))).toBe(true);
      }
    });

    it("throws when archetypes array is missing", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("archetypes"))).toBe(true);
      }
    });

    it("throws when archetypes entry is missing id", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("id"))).toBe(true);
      }
    });

    it("throws when archetypes entry is missing templateRoot", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("templateRoot"))).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Schema Validation: Empty Values
  // ===========================================================================

  describe("schema validation - empty values", () => {
    it("throws when pack.name is empty string", async () => {
      await writeManifest(testDir, `
pack:
  name: ""
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/name.*empty/i);
      }
    });

    it("throws when pack.name is whitespace only", async () => {
      await writeManifest(testDir, `
pack:
  name: "   "
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when pack.version is empty", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: ""
archetypes:
  - id: default
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/version.*empty/i);
      }
    });

    it("throws when archetypes array is empty", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
archetypes: []
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/at least one archetype/i);
      }
    });

    it("throws when archetype id is empty", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: ""
    templateRoot: templates
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/id.*empty/i);
      }
    });

    it("throws when archetype templateRoot is empty", async () => {
      await writeManifest(testDir, `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: ""
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/templateRoot.*empty/i);
      }
    });
  });

  // ===========================================================================
  // Schema Validation: Error Messages
  // ===========================================================================

  describe("schema validation - error messages", () => {
    it("error includes manifestPath", async () => {
      await writeManifest(testDir, `pack: not-an-object`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { manifestPath?: string } };
        expect(err.details?.manifestPath).toContain("archetype.yaml");
      }
    });

    it("error includes packRootDir", async () => {
      await writeManifest(testDir, `pack: not-an-object`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { packRootDir?: string } };
        expect(err.details?.packRootDir).toBe(testDir);
      }
    });

    it("error includes field path in issues", async () => {
      await writeManifest(testDir, `
pack:
  name: test
  version: 1.0.0
archetypes:
  - id: valid
    templateRoot: path
  - id: ""
    templateRoot: also-valid
`);

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { issues?: Array<{ path: string }> } };
        // Should indicate the second archetype (index 1) has the problem
        expect(err.details?.issues?.some((i) => i.path.includes("1"))).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Input Validation
  // ===========================================================================

  describe("input validation", () => {
    it("throws on relative path", async () => {
      await expect(loader.loadFromDir("relative/path")).rejects.toThrow(/absolute/i);
    });

    it("relative path error has correct code", async () => {
      try {
        await loader.loadFromDir("relative/path");
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_INVALID_PATH");
      }
    });
  });

  // ===========================================================================
  // Convenience Function
  // ===========================================================================

  describe("loadManifest convenience function", () => {
    it("loads manifest successfully", async () => {
      await writeManifest(testDir, createValidManifest({ packName: "convenience-test" }));

      const manifest = await loadManifest(testDir);

      expect(manifest.pack.name).toBe("convenience-test");
    });

    it("throws same errors as class method", async () => {
      await expect(loadManifest(testDir)).rejects.toThrow(/manifest not found/i);
    });
  });

  // ===========================================================================
  // Cross-Platform Compatibility
  // ===========================================================================

  describe("cross-platform compatibility", () => {
    it("handles paths with spaces", async () => {
      const spacedDir = path.join(testDir, "path with spaces");
      await fs.mkdir(spacedDir, { recursive: true });
      await writeManifest(spacedDir, createValidManifest());

      const manifest = await loader.loadFromDir(spacedDir);

      expect(manifest.pack.name).toBe("test-pack");
    });

    it("handles unicode in manifest content", async () => {
      const yaml = `pack:
  name: 日本語パック
  version: 1.0.0
archetypes:
  - id: 默认
    templateRoot: 模板/путь
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("日本語パック");
      expect(manifest.archetypes[0].id).toBe("默认");
    });

    it("handles deeply nested pack root", async () => {
      const deepDir = path.join(testDir, "a", "b", "c", "d", "e");
      await fs.mkdir(deepDir, { recursive: true });
      await writeManifest(deepDir, createValidManifest());

      const manifest = await loader.loadFromDir(deepDir);

      expect(manifest.packRootDir).toBe(deepDir);
    });
  });
});
