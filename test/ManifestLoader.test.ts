import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ManifestLoader, loadManifest } from "../src/core/manifest/ManifestLoader.js";

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
function createValidManifest(
  overrides: {
    packName?: string;
    packVersion?: string;
    archetypes?: Array<{ id?: string; templateRoot?: string }>;
  } = {},
): string {
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
  filename: string = "archetype.yaml",
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
      await writeManifest(
        testDir,
        createValidManifest({ packName: "pack-yaml-pack" }),
        "pack.yaml",
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.pack.name).toBe("pack-yaml-pack");
      expect(manifest.manifestPath).toContain("pack.yaml");
    });

    it("prefers archetype.yaml over pack.yaml when both exist", async () => {
      await writeManifest(
        testDir,
        createValidManifest({ packName: "from-archetype" }),
        "archetype.yaml",
      );
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
      await writeManifest(
        testDir,
        `
pack:
  name: test
  version: 1.0.0
archetypes:
  - id: broken
    templateRoot: [[[invalid yaml
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
name: bad-indent
  version: 1.0.0
`,
      );

      await expect(loader.loadFromDir(testDir)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Schema Validation: Missing Fields
  // ===========================================================================

  describe("schema validation - missing fields", () => {
    it("throws when pack object is missing", async () => {
      await writeManifest(
        testDir,
        `
archetypes:
  - id: default
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
archetypes:
  - id: default
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: ""
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: "   "
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when pack.version is empty", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: ""
archetypes:
  - id: default
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes: []
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: ""
    templateRoot: templates
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: ""
`,
      );

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
      await writeManifest(
        testDir,
        `
pack:
  name: test
  version: 1.0.0
archetypes:
  - id: valid
    templateRoot: path
  - id: ""
    templateRoot: also-valid
`,
      );

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

  // ===========================================================================
  // Patch Schema Validation - Valid Cases
  // ===========================================================================

  describe("patch schema validation - valid cases", () => {
    it("accepts marker_insert patch with file + markers + contentTemplate + idempotencyKey", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: src/index.ts
        kind: marker_insert
        markerStart: "// <SCAFFOLDIX:START:imports>"
        markerEnd: "// <SCAFFOLDIX:END:imports>"
        contentTemplate: 'import { User } from "./models/User";'
        idempotencyKey: add-user-import
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches).toBeDefined();
      expect(manifest.archetypes[0].patches).toHaveLength(1);
      expect(manifest.archetypes[0].patches![0].kind).toBe("marker_insert");
      expect(manifest.archetypes[0].patches![0].file).toBe("src/index.ts");
    });

    it("accepts marker_replace patch with file + markers + path + idempotencyKey", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: config.ts
        kind: marker_replace
        markerStart: "// <CONFIG:START>"
        markerEnd: "// <CONFIG:END>"
        path: patches/config-content.hbs
        idempotencyKey: replace-config
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches![0].kind).toBe("marker_replace");
      expect(manifest.archetypes[0].patches![0].path).toBe("patches/config-content.hbs");
    });

    it("accepts append_if_missing patch with file + contentTemplate + idempotencyKey", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: exports.ts
        kind: append_if_missing
        contentTemplate: 'export * from "./newModule";'
        idempotencyKey: add-export
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches![0].kind).toBe("append_if_missing");
      // append_if_missing should NOT have markers
      expect((manifest.archetypes[0].patches![0] as any).markerStart).toBeUndefined();
    });

    it("accepts optional description field on patch", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: index.ts
        kind: append_if_missing
        contentTemplate: "// footer"
        idempotencyKey: add-footer
        description: Adds a footer comment to the index file
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches![0].description).toBe(
        "Adds a footer comment to the index file",
      );
    });

    it("accepts optional strict field on patch", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: optional.ts
        kind: append_if_missing
        contentTemplate: content
        idempotencyKey: add-optional
        strict: false
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches![0].strict).toBe(false);
    });

    it("accepts multiple patches on same archetype", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: a.ts
        kind: append_if_missing
        contentTemplate: a
        idempotencyKey: patch-a
      - file: b.ts
        kind: append_if_missing
        contentTemplate: b
        idempotencyKey: patch-b
      - file: c.ts
        kind: marker_insert
        markerStart: "// START"
        markerEnd: "// END"
        contentTemplate: c
        idempotencyKey: patch-c
`,
      );

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches).toHaveLength(3);
    });

    it("accepts archetype without patches (patches is optional)", async () => {
      await writeManifest(testDir, createValidManifest());

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.archetypes[0].patches).toBeUndefined();
    });
  });

  // ===========================================================================
  // Scaffoldix Compatibility Schema
  // ===========================================================================

  describe("scaffoldix compatibility schema", () => {
    it("accepts manifest without scaffoldix section (backward compatible)", async () => {
      await writeManifest(testDir, createValidManifest());

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix).toBeUndefined();
    });

    it("accepts scaffoldix section with minVersion only", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility:
    minVersion: "0.2.0"
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility?.minVersion).toBe("0.2.0");
    });

    it("accepts scaffoldix section with maxVersion only", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility:
    maxVersion: "2.5.0"
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility?.maxVersion).toBe("2.5.0");
    });

    it("accepts scaffoldix section with both minVersion and maxVersion", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility:
    minVersion: "0.2.0"
    maxVersion: "2.5.0"
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility?.minVersion).toBe("0.2.0");
      expect(manifest.scaffoldix?.compatibility?.maxVersion).toBe("2.5.0");
    });

    it("accepts scaffoldix section with incompatible versions list", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility:
    minVersion: "0.2.0"
    incompatible:
      - "0.3.4"
      - "1.0.0-beta"
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility?.incompatible).toEqual(["0.3.4", "1.0.0-beta"]);
    });

    it("accepts empty compatibility object", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility: {}
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility).toBeDefined();
      expect(manifest.scaffoldix?.compatibility?.minVersion).toBeUndefined();
    });

    it("accepts full compatibility section with all fields", async () => {
      const yaml = `pack:
  name: test-pack
  version: 1.0.0
scaffoldix:
  compatibility:
    minVersion: "0.2.0"
    maxVersion: "2.5.0"
    incompatible:
      - "0.3.4"
      - "1.0.0-beta"
archetypes:
  - id: default
    templateRoot: templates
`;
      await writeManifest(testDir, yaml);

      const manifest = await loader.loadFromDir(testDir);

      expect(manifest.scaffoldix?.compatibility?.minVersion).toBe("0.2.0");
      expect(manifest.scaffoldix?.compatibility?.maxVersion).toBe("2.5.0");
      expect(manifest.scaffoldix?.compatibility?.incompatible).toEqual(["0.3.4", "1.0.0-beta"]);
    });
  });

  // ===========================================================================
  // Patch Schema Validation - Invalid Cases
  // ===========================================================================

  describe("patch schema validation - invalid cases", () => {
    it("throws when patch is missing file", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - kind: append_if_missing
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("file"))).toBe(true);
      }
    });

    it("throws when patch is missing kind", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("kind"))).toBe(true);
      }
    });

    it("throws when patch is missing idempotencyKey", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        contentTemplate: content
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("idempotencyKey"))).toBe(true);
      }
    });

    it("throws when marker_insert is missing markerStart", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: marker_insert
        markerEnd: "// END"
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("markerStart"))).toBe(true);
      }
    });

    it("throws when marker_insert is missing markerEnd", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: marker_insert
        markerStart: "// START"
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("markerEnd"))).toBe(true);
      }
    });

    it("throws when marker_replace is missing markers", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: marker_replace
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when append_if_missing includes markerStart", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        markerStart: "// START"
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/marker/i);
      }
    });

    it("throws when append_if_missing includes markerEnd", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        markerEnd: "// END"
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when neither contentTemplate nor path is provided", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/contentTemplate.*path|exactly one/i);
      }
    });

    it("throws when both contentTemplate and path are provided", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        contentTemplate: inline content
        path: patches/content.hbs
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; hint?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.hint).toMatch(/contentTemplate.*path|exactly one/i);
      }
    });

    it("throws when file is empty string", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: ""
        kind: append_if_missing
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when idempotencyKey is empty string", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        contentTemplate: content
        idempotencyKey: ""
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
      }
    });

    it("throws when kind is invalid value", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: default
    templateRoot: templates
    patches:
      - file: test.ts
        kind: invalid_kind
        contentTemplate: content
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { code?: string; details?: { issues?: Array<{ path: string }> } };
        expect(err.code).toBe("MANIFEST_SCHEMA_ERROR");
        expect(err.details?.issues?.some((i) => i.path.includes("kind"))).toBe(true);
      }
    });

    it("error message includes field path for nested patch errors", async () => {
      await writeManifest(
        testDir,
        `
pack:
  name: test-pack
  version: 1.0.0
archetypes:
  - id: first
    templateRoot: templates
  - id: second
    templateRoot: templates
    patches:
      - file: test.ts
        kind: append_if_missing
        idempotencyKey: test
`,
      );

      try {
        await loader.loadFromDir(testDir);
        expect.fail("Should have thrown");
      } catch (error) {
        const err = error as { details?: { issues?: Array<{ path: string }> } };
        // Should include path like "archetypes.1.patches.0"
        const hasNestedPath = err.details?.issues?.some(
          (i) => i.path.includes("archetypes") && i.path.includes("patches"),
        );
        expect(hasNestedPath).toBe(true);
      }
    });
  });
});
