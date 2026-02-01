/**
 * Tests for pack list --json output.
 *
 * Tests JSON formatting for the pack list command.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { formatPackListJson, type PackListResult } from "../src/cli/handlers/packListHandler.js";

describe("pack list --json", () => {
  describe("formatPackListJson", () => {
    it("formats empty pack list as valid JSON", () => {
      const result: PackListResult = {
        packs: [],
        registryExists: false,
      };

      const output = formatPackListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packs).toEqual([]);
    });

    it("formats single local pack correctly", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "my-pack",
            version: "1.0.0",
            origin: "local:/path/to/pack",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packs).toHaveLength(1);
      expect(parsed.packs[0].packId).toBe("my-pack");
      expect(parsed.packs[0].version).toBe("1.0.0");
      expect(parsed.packs[0].origin.type).toBe("local");
      expect(parsed.packs[0].origin.path).toBe("/path/to/pack");
    });

    it("formats git pack with commit correctly", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "git-pack",
            version: "2.0.0",
            origin: "git:https://github.com/org/repo@abc1234",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packs[0].origin.type).toBe("git");
      expect(parsed.packs[0].origin.url).toBe("https://github.com/org/repo");
      expect(parsed.packs[0].origin.commit).toBe("abc1234");
    });

    it("formats git pack with ref correctly", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "git-pack",
            version: "2.0.0",
            origin: "git:https://github.com/org/repo#main",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packs[0].origin.type).toBe("git");
      expect(parsed.packs[0].origin.url).toBe("https://github.com/org/repo");
      expect(parsed.packs[0].origin.ref).toBe("main");
    });

    it("formats multiple packs correctly", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "pack-a",
            version: "1.0.0",
            origin: "local:/path/a",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
          {
            packId: "pack-b",
            version: "2.0.0",
            origin: "git:https://github.com/org/repo@abc1234",
            installedAt: "2024-01-16T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);
      const parsed = JSON.parse(output);

      expect(parsed.packs).toHaveLength(2);
      expect(parsed.packs[0].packId).toBe("pack-a");
      expect(parsed.packs[1].packId).toBe("pack-b");
    });

    it("does not include ANSI color codes", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "my-pack",
            version: "1.0.0",
            origin: "local:/path/to/pack",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);

      // Check for ANSI escape sequences
      expect(output).not.toMatch(/\x1b\[/);
    });

    it("produces valid JSON that can be parsed", () => {
      const result: PackListResult = {
        packs: [
          {
            packId: "test",
            version: "1.0.0",
            origin: "local:/test",
            installedAt: "2024-01-15T10:30:00.000Z",
          },
        ],
        registryExists: true,
      };

      const output = formatPackListJson(result);

      // Should not throw
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });
});
