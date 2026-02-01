import { describe, it, expect, vi } from "vitest";
import {
  resolveInputs,
  type InputDefinition,
  type ResolveInputsParams,
  type PromptAdapter,
} from "../src/core/generate/InputResolver.js";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a mock prompt adapter that records calls and returns provided answers.
 */
function createMockPromptAdapter(answers: Record<string, unknown> = {}): {
  adapter: PromptAdapter;
  calls: Array<{ input: InputDefinition }>;
} {
  const calls: Array<{ input: InputDefinition }> = [];

  const adapter: PromptAdapter = {
    prompt: vi.fn(async (input: InputDefinition) => {
      calls.push({ input });
      return answers[input.name] ?? input.default ?? "";
    }),
  };

  return { adapter, calls };
}

// =============================================================================
// Tests
// =============================================================================

describe("InputResolver", () => {
  // ===========================================================================
  // Non-interactive mode (--yes)
  // ===========================================================================

  describe("non-interactive mode (--yes)", () => {
    it("uses default values when no provided values", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "projectName", type: "string", default: "my-project" },
        { name: "version", type: "string", default: "1.0.0" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result).toEqual({
        projectName: "my-project",
        version: "1.0.0",
      });
    });

    it("provided values override defaults", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "projectName", type: "string", default: "my-project" },
        { name: "version", type: "string", default: "1.0.0" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
        provided: {
          projectName: "custom-name",
        },
      });

      expect(result).toEqual({
        projectName: "custom-name",
        version: "1.0.0",
      });
    });

    it("does not call prompt adapter in non-interactive mode", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "name", type: "string", default: "default-name" },
      ];

      const { adapter, calls } = createMockPromptAdapter();

      await resolveInputs({
        inputsSchema,
        nonInteractive: true,
        prompt: adapter,
      });

      expect(calls.length).toBe(0);
      expect(adapter.prompt).not.toHaveBeenCalled();
    });

    it("throws error when required input has no default", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "requiredInput", type: "string", required: true },
      ];

      await expect(
        resolveInputs({
          inputsSchema,
          nonInteractive: true,
        }),
      ).rejects.toMatchObject({
        code: "MISSING_REQUIRED_INPUTS",
      });
    });

    it("error message includes input name", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "mySpecialInput", type: "string", required: true },
      ];

      try {
        await resolveInputs({
          inputsSchema,
          nonInteractive: true,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("mySpecialInput");
      }
    });

    it("error includes suggestion to run without --yes", async () => {
      const inputsSchema: InputDefinition[] = [{ name: "input1", type: "string", required: true }];

      try {
        await resolveInputs({
          inputsSchema,
          nonInteractive: true,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.hint).toContain("--yes");
      }
    });

    it("lists all missing required inputs in one error", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "input1", type: "string", required: true },
        { name: "input2", type: "string", required: true },
        { name: "input3", type: "string", required: true },
      ];

      try {
        await resolveInputs({
          inputsSchema,
          nonInteractive: true,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("input1");
        expect(err.message).toContain("input2");
        expect(err.message).toContain("input3");
      }
    });

    it("succeeds when required input has a default", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "requiredWithDefault", type: "string", required: true, default: "fallback" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result).toEqual({
        requiredWithDefault: "fallback",
      });
    });

    it("succeeds when required input is provided", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "requiredInput", type: "string", required: true },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
        provided: {
          requiredInput: "user-provided-value",
        },
      });

      expect(result).toEqual({
        requiredInput: "user-provided-value",
      });
    });

    it("omits optional inputs without defaults", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "optional1", type: "string" },
        { name: "optional2", type: "string", required: false },
        { name: "withDefault", type: "string", default: "has-default" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result).toEqual({
        withDefault: "has-default",
      });
      expect(result).not.toHaveProperty("optional1");
      expect(result).not.toHaveProperty("optional2");
    });
  });

  // ===========================================================================
  // Interactive mode
  // ===========================================================================

  describe("interactive mode", () => {
    it("calls prompt adapter for required inputs without defaults", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "projectName", type: "string", required: true },
      ];

      const { adapter, calls } = createMockPromptAdapter({
        projectName: "user-entered-name",
      });

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: false,
        prompt: adapter,
      });

      expect(calls.length).toBe(1);
      expect(calls[0].input.name).toBe("projectName");
      expect(result.projectName).toBe("user-entered-name");
    });

    it("does not prompt for inputs with defaults", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "withDefault", type: "string", default: "default-value" },
        { name: "noDefault", type: "string", required: true },
      ];

      const { adapter, calls } = createMockPromptAdapter({
        noDefault: "prompted-value",
      });

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: false,
        prompt: adapter,
      });

      expect(calls.length).toBe(1);
      expect(calls[0].input.name).toBe("noDefault");
      expect(result.withDefault).toBe("default-value");
      expect(result.noDefault).toBe("prompted-value");
    });

    it("does not prompt for provided values", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "input1", type: "string", required: true },
        { name: "input2", type: "string", required: true },
      ];

      const { adapter, calls } = createMockPromptAdapter({
        input2: "prompted-for-2",
      });

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: false,
        prompt: adapter,
        provided: {
          input1: "already-provided",
        },
      });

      expect(calls.length).toBe(1);
      expect(calls[0].input.name).toBe("input2");
      expect(result.input1).toBe("already-provided");
      expect(result.input2).toBe("prompted-for-2");
    });

    it("throws error when prompt adapter is missing in interactive mode", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "needsPrompt", type: "string", required: true },
      ];

      await expect(
        resolveInputs({
          inputsSchema,
          nonInteractive: false,
          // No prompt adapter provided
        }),
      ).rejects.toMatchObject({
        code: "PROMPT_ADAPTER_REQUIRED",
      });
    });
  });

  // ===========================================================================
  // Type coercion
  // ===========================================================================

  describe("type coercion", () => {
    it("coerces string default to number when type is number", async () => {
      const inputsSchema: InputDefinition[] = [{ name: "port", type: "number", default: "3000" }];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result.port).toBe(3000);
      expect(typeof result.port).toBe("number");
    });

    it("coerces string provided value to number when type is number", async () => {
      const inputsSchema: InputDefinition[] = [{ name: "port", type: "number" }];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
        provided: { port: "8080" },
      });

      expect(result.port).toBe(8080);
      expect(typeof result.port).toBe("number");
    });

    it("throws error when number coercion results in NaN", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "port", type: "number", default: "not-a-number" },
      ];

      await expect(
        resolveInputs({
          inputsSchema,
          nonInteractive: true,
        }),
      ).rejects.toMatchObject({
        code: "INPUT_TYPE_ERROR",
      });
    });

    it("coerces 'true' string to boolean true", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "enabled", type: "boolean", default: "true" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result.enabled).toBe(true);
      expect(typeof result.enabled).toBe("boolean");
    });

    it("coerces 'false' string to boolean false", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "disabled", type: "boolean", default: "false" },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result.disabled).toBe(false);
      expect(typeof result.disabled).toBe("boolean");
    });

    it("preserves boolean values as-is", async () => {
      const inputsSchema: InputDefinition[] = [{ name: "flag", type: "boolean", default: true }];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result.flag).toBe(true);
    });

    it("throws error for invalid boolean string", async () => {
      const inputsSchema: InputDefinition[] = [{ name: "flag", type: "boolean", default: "yes" }];

      await expect(
        resolveInputs({
          inputsSchema,
          nonInteractive: true,
        }),
      ).rejects.toMatchObject({
        code: "INPUT_TYPE_ERROR",
      });
    });
  });

  // ===========================================================================
  // Enum validation
  // ===========================================================================

  describe("enum validation", () => {
    it("accepts value in enum options", async () => {
      const inputsSchema: InputDefinition[] = [
        {
          name: "color",
          type: "enum",
          options: ["red", "green", "blue"],
          default: "green",
        },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result.color).toBe("green");
    });

    it("throws error when value not in enum options", async () => {
      const inputsSchema: InputDefinition[] = [
        {
          name: "color",
          type: "enum",
          options: ["red", "green", "blue"],
          default: "yellow",
        },
      ];

      await expect(
        resolveInputs({
          inputsSchema,
          nonInteractive: true,
        }),
      ).rejects.toMatchObject({
        code: "INPUT_ENUM_ERROR",
      });
    });

    it("error message includes valid options", async () => {
      const inputsSchema: InputDefinition[] = [
        {
          name: "size",
          type: "enum",
          options: ["small", "medium", "large"],
          default: "extra-large",
        },
      ];

      try {
        await resolveInputs({
          inputsSchema,
          nonInteractive: true,
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("small");
        expect(err.message).toContain("medium");
        expect(err.message).toContain("large");
      }
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe("edge cases", () => {
    it("returns empty object when no inputs defined", async () => {
      const result = await resolveInputs({
        inputsSchema: [],
        nonInteractive: true,
      });

      expect(result).toEqual({});
    });

    it("returns empty object when inputsSchema is undefined", async () => {
      const result = await resolveInputs({
        inputsSchema: undefined,
        nonInteractive: true,
      });

      expect(result).toEqual({});
    });

    it("handles mixed required and optional inputs", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "required1", type: "string", required: true, default: "req1-default" },
        { name: "optional1", type: "string" },
        { name: "required2", type: "number", required: true, default: 42 },
        { name: "optional2", type: "boolean", default: false },
      ];

      const result = await resolveInputs({
        inputsSchema,
        nonInteractive: true,
      });

      expect(result).toEqual({
        required1: "req1-default",
        required2: 42,
        optional2: false,
      });
    });

    it("includes archetype ref in error when provided", async () => {
      const inputsSchema: InputDefinition[] = [
        { name: "missingInput", type: "string", required: true },
      ];

      try {
        await resolveInputs({
          inputsSchema,
          nonInteractive: true,
          archetypeRef: "my-pack:my-archetype",
        });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.details?.archetypeRef).toBe("my-pack:my-archetype");
      }
    });
  });
});
