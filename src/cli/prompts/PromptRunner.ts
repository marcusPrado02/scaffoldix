/**
 * PromptRunner module for CLI input collection.
 *
 * Integrates with @clack/prompts to collect user inputs based on
 * InputDefinition schemas with validation feedback and re-prompting.
 *
 * Features:
 * - Type-specific prompts (text, confirm, select)
 * - Inline validation with custom error messages
 * - Re-prompt on invalid input until valid
 * - Cancellation handling with USER_CANCELLED error
 * - Custom messages displayed on validation failure
 *
 * @module
 */

import * as clack from "@clack/prompts";
import { ScaffoldError } from "../../core/errors/errors.js";
import {
  validateInput,
  type EnhancedInputDefinition,
  type EnumOption,
} from "../../core/inputs/InputValidator.js";
import type { InputDefinition, PromptAdapter } from "../../core/generate/InputResolver.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a PromptRunner (primarily for testing).
 */
export interface PromptRunnerOptions {
  /**
   * Mock responses for testing (input name -> value).
   */
  readonly mockResponses?: Record<string, unknown>;

  /**
   * Mock prompt function for testing.
   * Called instead of the real prompt, allows simulating user input.
   */
  readonly mockPromptFn?: (input: InputDefinition) => Promise<unknown>;

  /**
   * Callback when validation fails (for testing message display).
   */
  readonly onValidationError?: (message: string) => void;
}

/**
 * Symbol indicating user cancellation in @clack/prompts.
 */
function isCancel(value: unknown): boolean {
  return clack.isCancel(value);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Gets the label for an enum option.
 */
function getOptionLabel(option: EnumOption): string {
  if (typeof option === "string") {
    return option;
  }
  return option.label ?? option.value;
}

/**
 * Converts InputDefinition to EnhancedInputDefinition for validation.
 */
function toEnhancedDef(input: InputDefinition): EnhancedInputDefinition {
  return {
    name: input.name,
    type: input.type,
    required: input.required,
    minLength: input.minLength,
    maxLength: input.maxLength,
    regex: input.regex,
    min: input.min,
    max: input.max,
    integer: input.integer,
    options: input.options,
    messages: input.messages,
  };
}

// =============================================================================
// PromptRunner Class
// =============================================================================

/**
 * Runs interactive prompts for collecting user inputs.
 *
 * Implements the PromptAdapter interface for use with InputResolver.
 */
export class PromptRunner implements PromptAdapter {
  private readonly options: PromptRunnerOptions;

  constructor(options: PromptRunnerOptions = {}) {
    this.options = options;
  }

  /**
   * Prompts the user for an input value.
   *
   * @param input - The input definition
   * @returns The validated user-provided value
   * @throws ScaffoldError with code USER_CANCELLED if user cancels
   */
  async prompt(input: InputDefinition): Promise<unknown> {
    // Use mock if provided (for testing)
    if (this.options.mockResponses && input.name in this.options.mockResponses) {
      return this.options.mockResponses[input.name];
    }

    if (this.options.mockPromptFn) {
      return this.promptWithValidation(input, async () => {
        return this.options.mockPromptFn!(input);
      });
    }

    // Real prompt based on type
    switch (input.type) {
      case "boolean":
        return this.promptBoolean(input);
      case "enum":
        return this.promptEnum(input);
      case "number":
        return this.promptNumber(input);
      case "string":
      default:
        return this.promptString(input);
    }
  }

  /**
   * Prompts for a string value with validation.
   */
  private async promptString(input: InputDefinition): Promise<string> {
    const enhancedDef = toEnhancedDef(input);

    const result = await clack.text({
      message: input.prompt ?? `Enter ${input.name}:`,
      placeholder: input.description,
      defaultValue: input.default !== undefined ? String(input.default) : undefined,
      validate: (value) => {
        const validation = validateInput(value, enhancedDef);
        if (!validation.valid) {
          this.options.onValidationError?.(validation.message!);
          return validation.message;
        }
        return undefined;
      },
    });

    if (isCancel(result)) {
      throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
    }

    return result as string;
  }

  /**
   * Prompts for a number value with validation.
   */
  private async promptNumber(input: InputDefinition): Promise<number> {
    const enhancedDef = toEnhancedDef(input);

    const result = await clack.text({
      message: input.prompt ?? `Enter ${input.name}:`,
      placeholder: input.description,
      defaultValue: input.default !== undefined ? String(input.default) : undefined,
      validate: (value) => {
        const num = Number(value);
        if (Number.isNaN(num)) {
          const msg = "Please enter a valid number";
          this.options.onValidationError?.(msg);
          return msg;
        }
        const validation = validateInput(num, enhancedDef);
        if (!validation.valid) {
          this.options.onValidationError?.(validation.message!);
          return validation.message;
        }
        return undefined;
      },
    });

    if (isCancel(result)) {
      throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
    }

    return Number(result);
  }

  /**
   * Prompts for a boolean value.
   */
  private async promptBoolean(input: InputDefinition): Promise<boolean> {
    const result = await clack.confirm({
      message: input.prompt ?? `${input.name}?`,
      initialValue: input.default === true,
    });

    if (isCancel(result)) {
      throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
    }

    return result as boolean;
  }

  /**
   * Prompts for an enum value with select.
   */
  private async promptEnum(input: InputDefinition): Promise<string> {
    if (!input.options || input.options.length === 0) {
      throw new ScaffoldError(
        `Enum input '${input.name}' has no options defined`,
        "INPUT_VALIDATION_FAILED",
      );
    }

    const options = input.options.map((opt) => ({
      value: typeof opt === "string" ? opt : opt.value,
      label: getOptionLabel(opt),
    }));

    const result = await clack.select({
      message: input.prompt ?? `Select ${input.name}:`,
      options,
      initialValue: input.default !== undefined ? String(input.default) : undefined,
    });

    if (isCancel(result)) {
      throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
    }

    return result as string;
  }

  /**
   * Prompts with validation loop for mock testing.
   */
  private async promptWithValidation(
    input: InputDefinition,
    promptFn: () => Promise<unknown>,
  ): Promise<unknown> {
    const enhancedDef = toEnhancedDef(input);
    const maxAttempts = 10; // Prevent infinite loops in tests

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const value = await promptFn();

        // Check for cancellation
        if (value && typeof value === "object" && "cancelled" in value) {
          throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
        }

        // Validate
        const validation = validateInput(value, enhancedDef);
        if (validation.valid) {
          return value;
        }

        // Report validation error for testing
        const message =
          input.messages?.[validation.message?.includes("minLength") ? "minLength" : "invalid"] ??
          validation.message;
        this.options.onValidationError?.(message ?? "Validation failed");
      } catch (err) {
        // Re-throw cancellation errors
        if (err instanceof ScaffoldError && err.code === "USER_CANCELLED") {
          throw err;
        }
        // Check if mock threw cancellation object
        if (err && typeof err === "object" && "cancelled" in err) {
          throw new ScaffoldError("Operation cancelled by user", "USER_CANCELLED");
        }
        throw err;
      }
    }

    throw new ScaffoldError(
      `Max validation attempts exceeded for input '${input.name}'`,
      "INPUT_VALIDATION_FAILED",
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a PromptRunner instance.
 *
 * @param options - Configuration options
 * @returns PromptRunner that implements PromptAdapter
 *
 * @example
 * ```typescript
 * // Real usage
 * const runner = createPromptRunner();
 * const result = await resolveInputs({
 *   inputsSchema,
 *   nonInteractive: false,
 *   prompt: runner,
 * });
 *
 * // Testing
 * const runner = createPromptRunner({
 *   mockResponses: { projectName: "my-project" },
 * });
 * ```
 */
export function createPromptRunner(options: PromptRunnerOptions = {}): PromptRunner {
  return new PromptRunner(options);
}
