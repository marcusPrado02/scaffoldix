/**
 * Contract tests for pack manifests.
 *
 * These tests protect the pack manifest contract against regressions.
 * They verify that:
 * - Valid packs pass validation
 * - Invalid packs fail with specific, stable error codes
 * - Schema changes will break tests (intentional)
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ManifestLoader } from "../../../src/core/manifest/ManifestLoader.js";
import { ScaffoldError } from "../../../src/core/errors/errors.js";

// =============================================================================
// Test Setup
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const VALID_DIR = path.join(FIXTURES_DIR, "valid");
const INVALID_DIR = path.join(FIXTURES_DIR, "invalid");

const loader = new ManifestLoader();

// =============================================================================
// Helper Functions
// =============================================================================

function validFixture(name: string): string {
  return path.join(VALID_DIR, name);
}

function invalidFixture(name: string): string {
  return path.join(INVALID_DIR, name);
}

async function expectLoadToFail(
  packPath: string,
  expectedCode: string,
): Promise<ScaffoldError> {
  try {
    await loader.loadFromDir(packPath);
    throw new Error(`Expected loading ${packPath} to fail, but it succeeded`);
  } catch (error) {
    expect(error).toBeInstanceOf(ScaffoldError);
    const scaffoldError = error as ScaffoldError;
    expect(scaffoldError.code).toBe(expectedCode);
    return scaffoldError;
  }
}

// =============================================================================
// Valid Pack Tests
// =============================================================================

describe("Pack Contract: Valid Packs", () => {
  it("loads valid minimal pack successfully", async () => {
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));

    expect(manifest.pack.name).toBe("minimal-pack");
    expect(manifest.pack.version).toBe("1.0.0");
    expect(manifest.archetypes).toHaveLength(1);
    expect(manifest.archetypes[0].id).toBe("default");
    expect(manifest.archetypes[0].templateRoot).toBe("templates/example");
  });

  it("includes manifestPath and packRootDir metadata", async () => {
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));

    expect(manifest.manifestPath).toContain("archetype.yaml");
    expect(manifest.packRootDir).toBe(validFixture("minimal-pack"));
  });
});

// =============================================================================
// Invalid Pack Tests: Manifest Issues
// =============================================================================

describe("Pack Contract: Manifest Issues", () => {
  it("fails with MANIFEST_NOT_FOUND when no manifest exists", async () => {
    const error = await expectLoadToFail(
      invalidFixture("missing-manifest"),
      "MANIFEST_NOT_FOUND",
    );

    expect(error.message).toContain("manifest");
    expect(error.hint).toBeDefined();
  });

  it("fails with MANIFEST_YAML_ERROR for invalid YAML syntax", async () => {
    const error = await expectLoadToFail(
      invalidFixture("invalid-yaml"),
      "MANIFEST_YAML_ERROR",
    );

    expect(error.message).toMatch(/yaml|parse/i);
    expect(error.hint).toBeDefined();
  });
});

// =============================================================================
// Invalid Pack Tests: Missing Required Fields
// =============================================================================

describe("Pack Contract: Missing Required Fields", () => {
  it("fails with MANIFEST_SCHEMA_ERROR when pack.name is missing", async () => {
    const error = await expectLoadToFail(
      invalidFixture("missing-pack-fields"),
      "MANIFEST_SCHEMA_ERROR",
    );

    // Error should mention which field is missing
    expect(error.message).toMatch(/validation|invalid/i);
  });

  it("fails with MANIFEST_SCHEMA_ERROR when archetypes is empty", async () => {
    const error = await expectLoadToFail(
      invalidFixture("missing-archetypes"),
      "MANIFEST_SCHEMA_ERROR",
    );

    expect(error.message).toMatch(/validation|invalid/i);
  });
});

// =============================================================================
// Invalid Pack Tests: Incomplete Archetypes
// =============================================================================

describe("Pack Contract: Incomplete Archetypes", () => {
  it("fails with MANIFEST_SCHEMA_ERROR when archetype.id is missing", async () => {
    const error = await expectLoadToFail(
      invalidFixture("archetype-missing-id"),
      "MANIFEST_SCHEMA_ERROR",
    );

    expect(error.message).toMatch(/validation|invalid/i);
  });

  it("fails with MANIFEST_SCHEMA_ERROR when archetype.templateRoot is missing", async () => {
    const error = await expectLoadToFail(
      invalidFixture("archetype-missing-templateRoot"),
      "MANIFEST_SCHEMA_ERROR",
    );

    expect(error.message).toMatch(/validation|invalid/i);
  });
});

// =============================================================================
// Invalid Pack Tests: Invalid Nested Structures
// =============================================================================

describe("Pack Contract: Invalid Nested Structures", () => {
  it("fails with MANIFEST_SCHEMA_ERROR for invalid patch structure", async () => {
    const error = await expectLoadToFail(
      invalidFixture("archetype-invalid-patch-shape"),
      "MANIFEST_SCHEMA_ERROR",
    );

    expect(error.message).toMatch(/validation|invalid/i);
  });

  it("fails with MANIFEST_SCHEMA_ERROR for invalid hooks structure", async () => {
    const error = await expectLoadToFail(
      invalidFixture("archetype-invalid-hooks"),
      "MANIFEST_SCHEMA_ERROR",
    );

    expect(error.message).toMatch(/validation|invalid/i);
  });
});

// =============================================================================
// Error Quality Tests
// =============================================================================

describe("Pack Contract: Error Quality", () => {
  it("provides actionable hint for missing manifest", async () => {
    const error = await expectLoadToFail(
      invalidFixture("missing-manifest"),
      "MANIFEST_NOT_FOUND",
    );

    // Hint should tell user what files are expected
    expect(error.hint).toMatch(/archetype\.yaml|pack\.yaml/);
  });

  it("provides actionable hint for invalid YAML", async () => {
    const error = await expectLoadToFail(
      invalidFixture("invalid-yaml"),
      "MANIFEST_YAML_ERROR",
    );

    // Hint should help user fix the YAML
    expect(error.hint).toBeDefined();
    expect(error.hint!.length).toBeGreaterThan(0);
  });

  it("includes pack path in error details", async () => {
    const error = await expectLoadToFail(
      invalidFixture("missing-manifest"),
      "MANIFEST_NOT_FOUND",
    );

    expect(error.details?.packRootDir).toBe(invalidFixture("missing-manifest"));
  });

  it("errors are deterministic (same input = same error)", async () => {
    const error1 = await expectLoadToFail(
      invalidFixture("missing-manifest"),
      "MANIFEST_NOT_FOUND",
    );

    const error2 = await expectLoadToFail(
      invalidFixture("missing-manifest"),
      "MANIFEST_NOT_FOUND",
    );

    expect(error1.code).toBe(error2.code);
    expect(error1.message).toBe(error2.message);
  });
});

// =============================================================================
// Contract Stability Tests
// =============================================================================

describe("Pack Contract: Schema Stability", () => {
  it("requires pack.name to be a non-empty string", async () => {
    // This test documents the contract: pack.name is required
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));
    expect(typeof manifest.pack.name).toBe("string");
    expect(manifest.pack.name.length).toBeGreaterThan(0);
  });

  it("requires pack.version to be a non-empty string", async () => {
    // This test documents the contract: pack.version is required
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));
    expect(typeof manifest.pack.version).toBe("string");
    expect(manifest.pack.version.length).toBeGreaterThan(0);
  });

  it("requires at least one archetype", async () => {
    // This test documents the contract: at least one archetype is required
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));
    expect(manifest.archetypes.length).toBeGreaterThanOrEqual(1);
  });

  it("requires archetype.id to be a non-empty string", async () => {
    // This test documents the contract: archetype.id is required
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));
    expect(typeof manifest.archetypes[0].id).toBe("string");
    expect(manifest.archetypes[0].id.length).toBeGreaterThan(0);
  });

  it("requires archetype.templateRoot to be a non-empty string", async () => {
    // This test documents the contract: archetype.templateRoot is required
    const manifest = await loader.loadFromDir(validFixture("minimal-pack"));
    expect(typeof manifest.archetypes[0].templateRoot).toBe("string");
    expect(manifest.archetypes[0].templateRoot.length).toBeGreaterThan(0);
  });
});
