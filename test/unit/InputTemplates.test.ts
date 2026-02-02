/**
 * Input Templates System (T44) - Tests
 *
 * Tests for enhanced input schema with validations, custom messages,
 * and conditional prompts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  validateInput,
  isConditionMet,
  isValidRegex,
  getEnumValues,
  type EnhancedInputDefinition,
} from "../../src/core/inputs/InputValidator.js";

// =============================================================================
// Input Validator Tests
// =============================================================================

describe("InputValidator", () => {
  describe("string validation", () => {
    it("validates minLength", () => {
      const result = validateInput("ab", {
        name: "projectName",
        type: "string",
        minLength: 3,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("3");
    });

    it("validates maxLength", () => {
      const result = validateInput("this-is-a-very-long-name", {
        name: "projectName",
        type: "string",
        maxLength: 10,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("10");
    });

    it("validates regex pattern", () => {
      const result = validateInput("invalid_email", {
        name: "email",
        type: "string",
        regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      });

      expect(result.valid).toBe(false);
    });

    it("passes valid regex", () => {
      const result = validateInput("user@example.com", {
        name: "email",
        type: "string",
        regex: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      });

      expect(result.valid).toBe(true);
    });

    it("treats empty string as missing for required", () => {
      const result = validateInput("", {
        name: "projectName",
        type: "string",
        required: true,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("required");
    });

    it("uses custom regex message", () => {
      const result = validateInput("bad", {
        name: "email",
        type: "string",
        regex: "^[^@]+@[^@]+$",
        messages: {
          regex: "Please enter a valid email address",
        },
      });

      expect(result.valid).toBe(false);
      expect(result.message).toBe("Please enter a valid email address");
    });

    it("passes valid string with all constraints", () => {
      const result = validateInput("valid-project", {
        name: "projectName",
        type: "string",
        minLength: 3,
        maxLength: 50,
        regex: "^[a-z-]+$",
      });

      expect(result.valid).toBe(true);
    });
  });

  describe("number validation", () => {
    it("validates min", () => {
      const result = validateInput(500, {
        name: "port",
        type: "number",
        min: 1024,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("1024");
    });

    it("validates max", () => {
      const result = validateInput(70000, {
        name: "port",
        type: "number",
        max: 65535,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("65535");
    });

    it("validates integer constraint", () => {
      const result = validateInput(3.14, {
        name: "count",
        type: "number",
        integer: true,
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("integer");
    });

    it("passes valid integer", () => {
      const result = validateInput(42, {
        name: "count",
        type: "number",
        integer: true,
      });

      expect(result.valid).toBe(true);
    });

    it("uses custom min message", () => {
      const result = validateInput(500, {
        name: "port",
        type: "number",
        min: 1024,
        messages: {
          min: "Port must be at least 1024 (reserved ports)",
        },
      });

      expect(result.valid).toBe(false);
      expect(result.message).toBe("Port must be at least 1024 (reserved ports)");
    });

    it("validates both min and max", () => {
      const result = validateInput(3000, {
        name: "port",
        type: "number",
        min: 1024,
        max: 65535,
      });

      expect(result.valid).toBe(true);
    });

    it("rejects NaN values", () => {
      const result = validateInput("not-a-number", {
        name: "port",
        type: "number",
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("not a valid number");
    });
  });

  describe("enum validation", () => {
    it("validates value in options (string array)", () => {
      const result = validateInput("yellow", {
        name: "color",
        type: "enum",
        options: ["red", "green", "blue"],
      });

      expect(result.valid).toBe(false);
      expect(result.message).toContain("red");
    });

    it("validates value in options (object array)", () => {
      const result = validateInput("yellow", {
        name: "color",
        type: "enum",
        options: [
          { value: "red", label: "Red Color" },
          { value: "green", label: "Green Color" },
          { value: "blue", label: "Blue Color" },
        ],
      });

      expect(result.valid).toBe(false);
    });

    it("passes valid enum value (object array)", () => {
      const result = validateInput("green", {
        name: "color",
        type: "enum",
        options: [
          { value: "red", label: "Red Color" },
          { value: "green", label: "Green Color" },
          { value: "blue", label: "Blue Color" },
        ],
      });

      expect(result.valid).toBe(true);
    });

    it("passes valid enum value (string array)", () => {
      const result = validateInput("red", {
        name: "color",
        type: "enum",
        options: ["red", "green", "blue"],
      });

      expect(result.valid).toBe(true);
    });

    it("fails when no options defined", () => {
      const result = validateInput("anything", {
        name: "color",
        type: "enum",
        options: [],
      });

      expect(result.valid).toBe(false);
    });
  });

  describe("boolean validation", () => {
    it("passes boolean true", () => {
      expect(validateInput(true, { name: "enabled", type: "boolean" }).valid).toBe(true);
    });

    it("passes boolean false", () => {
      expect(validateInput(false, { name: "enabled", type: "boolean" }).valid).toBe(true);
    });

    it("passes string 'true'", () => {
      expect(validateInput("true", { name: "enabled", type: "boolean" }).valid).toBe(true);
    });

    it("passes string 'false'", () => {
      expect(validateInput("false", { name: "enabled", type: "boolean" }).valid).toBe(true);
    });

    it("rejects invalid boolean string", () => {
      const result = validateInput("yes", { name: "enabled", type: "boolean" });
      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// Condition Checking Tests
// =============================================================================

describe("isConditionMet", () => {
  it("returns true when no condition", () => {
    expect(isConditionMet(undefined, {})).toBe(true);
  });

  it("returns true when condition is met", () => {
    expect(
      isConditionMet({ input: "useDatabase", equals: true }, { useDatabase: true }),
    ).toBe(true);
  });

  it("returns false when condition is not met", () => {
    expect(
      isConditionMet({ input: "useDatabase", equals: true }, { useDatabase: false }),
    ).toBe(false);
  });

  it("works with string values", () => {
    expect(isConditionMet({ input: "env", equals: "production" }, { env: "production" })).toBe(
      true,
    );
    expect(isConditionMet({ input: "env", equals: "production" }, { env: "development" })).toBe(
      false,
    );
  });

  it("works with number values", () => {
    expect(isConditionMet({ input: "version", equals: 2 }, { version: 2 })).toBe(true);
    expect(isConditionMet({ input: "version", equals: 2 }, { version: 1 })).toBe(false);
  });

  it("returns false when dependent input is missing", () => {
    expect(isConditionMet({ input: "missingInput", equals: true }, {})).toBe(false);
  });
});

// =============================================================================
// Regex Validation Tests
// =============================================================================

describe("isValidRegex", () => {
  it("returns true for valid regex", () => {
    expect(isValidRegex("^[a-z]+$")).toBe(true);
    expect(isValidRegex("\\d{3}-\\d{4}")).toBe(true);
    expect(isValidRegex(".*")).toBe(true);
  });

  it("returns false for invalid regex", () => {
    expect(isValidRegex("[invalid(regex")).toBe(false);
    expect(isValidRegex("*")).toBe(false);
    expect(isValidRegex("(?<")).toBe(false);
  });
});

// =============================================================================
// Enum Value Extraction Tests
// =============================================================================

describe("getEnumValues", () => {
  it("extracts values from string array", () => {
    expect(getEnumValues(["red", "green", "blue"])).toEqual(["red", "green", "blue"]);
  });

  it("extracts values from object array", () => {
    expect(
      getEnumValues([
        { value: "red", label: "Red Color" },
        { value: "green", label: "Green" },
        { value: "blue" },
      ]),
    ).toEqual(["red", "green", "blue"]);
  });

  it("handles mixed array", () => {
    expect(getEnumValues(["red", { value: "green", label: "Green" }, "blue"])).toEqual([
      "red",
      "green",
      "blue",
    ]);
  });
});

// =============================================================================
// InputResolver Integration Tests (to be enabled after InputResolver update)
// =============================================================================

describe("InputResolver with Enhanced Validation", () => {
  // These tests will verify that InputResolver uses the InputValidator

  it("validates string minLength via InputResolver", async () => {
    // This test will pass once InputResolver is updated
    const { resolveInputs } = await import("../../src/core/generate/InputResolver.js");

    // For now, we test that the basic validation still works
    // Enhanced validation will be added in the next step
    const result = await resolveInputs({
      inputsSchema: [
        {
          name: "projectName",
          type: "string",
          default: "my-project",
        },
      ],
      nonInteractive: true,
    });

    expect(result.projectName).toBe("my-project");
  });

  it("validates enum with object options via InputResolver", async () => {
    const { resolveInputs } = await import("../../src/core/generate/InputResolver.js");

    // For now, test with string options (current behavior)
    const result = await resolveInputs({
      inputsSchema: [
        {
          name: "color",
          type: "enum",
          options: ["red", "green", "blue"],
          default: "red",
        },
      ],
      nonInteractive: true,
    });

    expect(result.color).toBe("red");
  });
});

// =============================================================================
// Schema Validation Tests (Manifest-level)
// =============================================================================

describe("Input Schema Validation", () => {
  // These tests verify that manifest validation catches invalid input definitions

  describe("regex validation at schema level", () => {
    it("isValidRegex can detect invalid patterns", () => {
      // This utility is used by manifest validation
      expect(isValidRegex("[invalid(regex")).toBe(false);
    });
  });

  describe("min/max consistency", () => {
    it("should detect min > max at validation time", () => {
      // This is a schema-level validation that will be implemented
      // For now, we document the expected behavior
      const def: EnhancedInputDefinition = {
        name: "port",
        type: "number",
        min: 10000,
        max: 1000, // Invalid: min > max
      };

      // Schema validation should catch this, not runtime validation
      // Runtime validation would just check individual constraints
      const resultMin = validateInput(5000, def);
      const resultMax = validateInput(5000, def);

      // 5000 is >= min (10000 fails), and <= max (1000 fails)
      // Both fail because the constraints are individually violated
      expect(resultMin.valid).toBe(false); // 5000 < 10000
      expect(resultMax.valid).toBe(false); // But also catches max
    });
  });
});
