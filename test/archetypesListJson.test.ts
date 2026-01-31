/**
 * Tests for list archetypes --json output.
 *
 * Tests JSON formatting for the archetypes list command.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  formatArchetypesListJson,
  type ArchetypesListResult,
} from "../src/cli/handlers/archetypesListHandler.js";

describe("list archetypes --json", () => {
  describe("formatArchetypesListJson", () => {
    it("formats empty archetypes list correctly", () => {
      const result: ArchetypesListResult = {
        archetypes: [],
        noPacksInstalled: true,
        warnings: [],
      };

      const output = formatArchetypesListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toEqual([]);
    });

    it("formats archetypes with packId and id correctly", () => {
      const result: ArchetypesListResult = {
        archetypes: ["pack-a:entity", "pack-a:controller", "pack-b:service"],
        noPacksInstalled: false,
        warnings: [],
      };

      const output = formatArchetypesListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toHaveLength(3);
      expect(parsed.archetypes[0]).toEqual({ packId: "pack-a", id: "entity" });
      expect(parsed.archetypes[1]).toEqual({ packId: "pack-a", id: "controller" });
      expect(parsed.archetypes[2]).toEqual({ packId: "pack-b", id: "service" });
    });

    it("does not include warnings in JSON output", () => {
      const result: ArchetypesListResult = {
        archetypes: ["pack-a:entity"],
        noPacksInstalled: false,
        warnings: ["Warning: pack 'bad' is missing"],
      };

      const output = formatArchetypesListJson(result);
      const parsed = JSON.parse(output);

      // Warnings should not appear in the JSON output (they go to stderr)
      expect(parsed.warnings).toBeUndefined();
    });

    it("produces valid JSON without ANSI codes", () => {
      const result: ArchetypesListResult = {
        archetypes: ["test:archetype"],
        noPacksInstalled: false,
        warnings: [],
      };

      const output = formatArchetypesListJson(result);

      // Should not throw
      expect(() => JSON.parse(output)).not.toThrow();

      // Should not contain ANSI escape codes
      expect(output).not.toMatch(/\x1b\[/);
    });

    it("handles multiple archetypes from same pack", () => {
      const result: ArchetypesListResult = {
        archetypes: ["my-pack:a1", "my-pack:a2", "my-pack:a3"],
        noPacksInstalled: false,
        warnings: [],
      };

      const output = formatArchetypesListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.archetypes).toHaveLength(3);
      expect(parsed.archetypes.every((a: { packId: string }) => a.packId === "my-pack")).toBe(true);
    });
  });
});
