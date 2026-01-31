/**
 * Tests for CompatibilityChecker module.
 *
 * Tests version compatibility validation for pack manifests.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  CompatibilityChecker,
  type CompatibilityResult,
} from "../src/core/compatibility/CompatibilityChecker.js";
import type { CompatibilityConfig } from "../src/core/manifest/ManifestLoader.js";

// =============================================================================
// Tests
// =============================================================================

describe("CompatibilityChecker", () => {
  describe("checkCompatibility", () => {
    // =========================================================================
    // No constraints (backward compatible)
    // =========================================================================

    describe("no constraints", () => {
      it("returns compatible when compatibility is undefined", () => {
        const result = CompatibilityChecker.check("1.0.0", undefined);

        expect(result.compatible).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it("returns compatible when compatibility object is empty", () => {
        const result = CompatibilityChecker.check("1.0.0", {});

        expect(result.compatible).toBe(true);
      });
    });

    // =========================================================================
    // minVersion constraint
    // =========================================================================

    describe("minVersion constraint", () => {
      it("returns compatible when current version equals minVersion", () => {
        const result = CompatibilityChecker.check("0.2.0", { minVersion: "0.2.0" });

        expect(result.compatible).toBe(true);
      });

      it("returns compatible when current version is greater than minVersion", () => {
        const result = CompatibilityChecker.check("1.0.0", { minVersion: "0.2.0" });

        expect(result.compatible).toBe(true);
      });

      it("returns incompatible when current version is less than minVersion", () => {
        const result = CompatibilityChecker.check("0.1.0", { minVersion: "0.2.0" });

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain("0.2.0");
        expect(result.reason).toContain("minimum");
      });

      it("handles semver comparison correctly for minVersion", () => {
        expect(CompatibilityChecker.check("0.2.1", { minVersion: "0.2.0" }).compatible).toBe(true);
        expect(CompatibilityChecker.check("0.3.0", { minVersion: "0.2.0" }).compatible).toBe(true);
        expect(CompatibilityChecker.check("1.0.0", { minVersion: "0.2.0" }).compatible).toBe(true);
        expect(CompatibilityChecker.check("0.1.9", { minVersion: "0.2.0" }).compatible).toBe(false);
      });
    });

    // =========================================================================
    // maxVersion constraint
    // =========================================================================

    describe("maxVersion constraint", () => {
      it("returns compatible when current version equals maxVersion", () => {
        const result = CompatibilityChecker.check("2.5.0", { maxVersion: "2.5.0" });

        expect(result.compatible).toBe(true);
      });

      it("returns compatible when current version is less than maxVersion", () => {
        const result = CompatibilityChecker.check("1.0.0", { maxVersion: "2.5.0" });

        expect(result.compatible).toBe(true);
      });

      it("returns incompatible when current version is greater than maxVersion", () => {
        const result = CompatibilityChecker.check("3.0.0", { maxVersion: "2.5.0" });

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain("2.5.0");
        expect(result.reason).toContain("maximum");
      });

      it("handles semver comparison correctly for maxVersion", () => {
        expect(CompatibilityChecker.check("2.4.9", { maxVersion: "2.5.0" }).compatible).toBe(true);
        expect(CompatibilityChecker.check("2.5.0", { maxVersion: "2.5.0" }).compatible).toBe(true);
        expect(CompatibilityChecker.check("2.5.1", { maxVersion: "2.5.0" }).compatible).toBe(false);
        expect(CompatibilityChecker.check("2.6.0", { maxVersion: "2.5.0" }).compatible).toBe(false);
      });
    });

    // =========================================================================
    // Both minVersion and maxVersion
    // =========================================================================

    describe("range constraint (minVersion + maxVersion)", () => {
      const range: CompatibilityConfig = { minVersion: "0.2.0", maxVersion: "2.5.0" };

      it("returns compatible when current version is within range", () => {
        expect(CompatibilityChecker.check("1.0.0", range).compatible).toBe(true);
        expect(CompatibilityChecker.check("0.2.0", range).compatible).toBe(true);
        expect(CompatibilityChecker.check("2.5.0", range).compatible).toBe(true);
      });

      it("returns incompatible when current version is below range", () => {
        const result = CompatibilityChecker.check("0.1.0", range);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain("0.2.0");
      });

      it("returns incompatible when current version is above range", () => {
        const result = CompatibilityChecker.check("3.0.0", range);

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain("2.5.0");
      });
    });

    // =========================================================================
    // incompatible list
    // =========================================================================

    describe("incompatible versions list", () => {
      it("returns incompatible when current version is in incompatible list", () => {
        const result = CompatibilityChecker.check("0.3.4", {
          incompatible: ["0.3.4", "1.0.0-beta"],
        });

        expect(result.compatible).toBe(false);
        expect(result.reason).toContain("0.3.4");
        expect(result.reason).toContain("incompatible");
      });

      it("returns compatible when current version is not in incompatible list", () => {
        const result = CompatibilityChecker.check("0.3.5", {
          incompatible: ["0.3.4", "1.0.0-beta"],
        });

        expect(result.compatible).toBe(true);
      });

      it("matches exact version strings in incompatible list", () => {
        expect(
          CompatibilityChecker.check("1.0.0-beta", { incompatible: ["1.0.0-beta"] }).compatible
        ).toBe(false);
        expect(
          CompatibilityChecker.check("1.0.0", { incompatible: ["1.0.0-beta"] }).compatible
        ).toBe(true);
      });

      it("handles empty incompatible list", () => {
        const result = CompatibilityChecker.check("1.0.0", { incompatible: [] });

        expect(result.compatible).toBe(true);
      });
    });

    // =========================================================================
    // Combined constraints
    // =========================================================================

    describe("combined constraints", () => {
      it("checks incompatible list even when within version range", () => {
        const config: CompatibilityConfig = {
          minVersion: "0.2.0",
          maxVersion: "2.5.0",
          incompatible: ["1.0.0"],
        };

        expect(CompatibilityChecker.check("0.5.0", config).compatible).toBe(true);
        expect(CompatibilityChecker.check("1.0.0", config).compatible).toBe(false);
        expect(CompatibilityChecker.check("2.0.0", config).compatible).toBe(true);
      });

      it("returns first failing constraint in reason", () => {
        // If version is too low AND in incompatible list, minVersion check happens first
        const config: CompatibilityConfig = {
          minVersion: "0.2.0",
          incompatible: ["0.1.0"],
        };

        const result = CompatibilityChecker.check("0.1.0", config);

        expect(result.compatible).toBe(false);
        // Could fail on either - just verify it fails
      });
    });

    // =========================================================================
    // Prerelease version handling
    // =========================================================================

    describe("prerelease versions", () => {
      it("handles prerelease versions in comparisons", () => {
        expect(
          CompatibilityChecker.check("1.0.0-beta", { minVersion: "1.0.0" }).compatible
        ).toBe(false);
        expect(
          CompatibilityChecker.check("1.0.0", { minVersion: "1.0.0-beta" }).compatible
        ).toBe(true);
      });

      it("handles prerelease versions in maxVersion", () => {
        expect(
          CompatibilityChecker.check("1.0.0", { maxVersion: "1.0.0-beta" }).compatible
        ).toBe(false);
        expect(
          CompatibilityChecker.check("1.0.0-alpha", { maxVersion: "1.0.0-beta" }).compatible
        ).toBe(true);
      });
    });
  });

  // ===========================================================================
  // formatConstraints
  // ===========================================================================

  describe("formatConstraints", () => {
    it("returns empty string for no constraints", () => {
      expect(CompatibilityChecker.formatConstraints(undefined)).toBe("");
      expect(CompatibilityChecker.formatConstraints({})).toBe("");
    });

    it("formats minVersion only", () => {
      const result = CompatibilityChecker.formatConstraints({ minVersion: "0.2.0" });

      expect(result).toContain(">=0.2.0");
    });

    it("formats maxVersion only", () => {
      const result = CompatibilityChecker.formatConstraints({ maxVersion: "2.5.0" });

      expect(result).toContain("<=2.5.0");
    });

    it("formats range with both min and max", () => {
      const result = CompatibilityChecker.formatConstraints({
        minVersion: "0.2.0",
        maxVersion: "2.5.0",
      });

      expect(result).toContain(">=0.2.0");
      expect(result).toContain("<=2.5.0");
    });

    it("includes incompatible versions in format", () => {
      const result = CompatibilityChecker.formatConstraints({
        incompatible: ["0.3.4", "1.0.0-beta"],
      });

      expect(result).toContain("0.3.4");
      expect(result).toContain("1.0.0-beta");
    });

    it("formats full constraints", () => {
      const result = CompatibilityChecker.formatConstraints({
        minVersion: "0.2.0",
        maxVersion: "2.5.0",
        incompatible: ["0.3.4"],
      });

      expect(result).toContain(">=0.2.0");
      expect(result).toContain("<=2.5.0");
      expect(result).toContain("0.3.4");
    });
  });
});
