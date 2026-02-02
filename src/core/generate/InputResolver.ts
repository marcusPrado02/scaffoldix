/**
 * InputResolver module for resolving inputs from manifest schema.
 *
 * Handles input resolution for generate command with support for:
 * - Non-interactive mode (--yes) using defaults only
 * - Interactive mode with prompting for missing required inputs
 * - Type coercion (string to number/boolean)
 * - Enhanced validation (minLength, maxLength, regex, min, max, integer)
 * - Conditional prompts (when clause)
 * - Enum options as objects with value/label
 *
 * @module
 */

import { ScaffoldError } from "../errors/errors.js";
import {
  validateInput,
  isConditionMet,
  getEnumValues,
  type EnhancedInputDefinition,
  type EnumOption,
  type ValidationMessages,
} from "../inputs/InputValidator.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Supported input types.
 */
export type InputType = "string" | "number" | "boolean" | "enum";

/**
 * Definition of a single input from manifest schema.
 * Re-exported for backward compatibility.
 */
export interface InputDefinition {
  /** Unique name of the input */
  readonly name: string;

  /** Type of the input value */
  readonly type: InputType;

  /** Whether this input is required */
  readonly required?: boolean;

  /** Default value if not provided */
  readonly default?: unknown;

  /** Prompt text for interactive mode */
  readonly prompt?: string;

  /** Description/help text */
  readonly description?: string;

  // String validations
  /** Minimum length for string inputs */
  readonly minLength?: number;
  /** Maximum length for string inputs */
  readonly maxLength?: number;
  /** Regex pattern for string validation */
  readonly regex?: string;

  // Number validations
  /** Minimum value for number inputs */
  readonly min?: number;
  /** Maximum value for number inputs */
  readonly max?: number;
  /** Whether number must be an integer */
  readonly integer?: boolean;

  /** Valid options for enum type (string or object array) */
  readonly options?: readonly EnumOption[];

  /** Custom validation messages */
  readonly messages?: ValidationMessages;

  /** Conditional display condition */
  readonly when?: {
    readonly input: string;
    readonly equals: string | number | boolean;
  };
}

/**
 * Adapter interface for prompting users in interactive mode.
 */
export interface PromptAdapter {
  /**
   * Prompts the user for an input value.
   *
   * @param input - The input definition
   * @returns The user-provided value
   */
  prompt(input: InputDefinition): Promise<unknown>;
}

/**
 * Parameters for resolving inputs.
 */
export interface ResolveInputsParams {
  /** Input definitions from manifest schema */
  readonly inputsSchema?: readonly InputDefinition[];

  /** Whether running in non-interactive mode (--yes) */
  readonly nonInteractive: boolean;

  /** Prompt adapter for interactive mode */
  readonly prompt?: PromptAdapter;

  /** Pre-provided values (highest priority) */
  readonly provided?: Record<string, unknown>;

  /** Optional archetype reference for error messages */
  readonly archetypeRef?: string;
}

// =============================================================================
// Type Coercion
// =============================================================================

/**
 * Coerces a value to the expected type.
 *
 * @param value - The value to coerce
 * @param type - The expected type
 * @param inputName - Input name for error messages
 * @returns The coerced value
 * @throws ScaffoldError if coercion fails
 */
function coerceValue(value: unknown, type: InputType, inputName: string): unknown {
  // Already the correct type
  if (type === "string") {
    return String(value);
  }

  if (type === "number") {
    if (typeof value === "number") {
      return value;
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new ScaffoldError(
        `Input '${inputName}' cannot be converted to number: '${value}'`,
        "INPUT_TYPE_ERROR",
      );
    }
    return num;
  }

  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    const str = String(value).toLowerCase();
    if (str === "true") {
      return true;
    }
    if (str === "false") {
      return false;
    }
    throw new ScaffoldError(
      `Input '${inputName}' cannot be converted to boolean: '${value}'. Use 'true' or 'false'.`,
      "INPUT_TYPE_ERROR",
    );
  }

  // enum type - no coercion, validation happens separately
  return value;
}

/**
 * Validates a value against input definition constraints.
 *
 * @param value - The value to validate (already coerced)
 * @param input - The input definition with validation rules
 * @throws ScaffoldError if validation fails
 */
function validateValue(value: unknown, input: InputDefinition): void {
  // Convert InputDefinition to EnhancedInputDefinition for validation
  const enhancedDef: EnhancedInputDefinition = {
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

  const result = validateInput(value, enhancedDef);

  if (!result.valid) {
    throw new ScaffoldError(
      result.message ?? `Input '${input.name}' validation failed`,
      "INPUT_VALIDATION_FAILED",
      { inputName: input.name, value },
      undefined,
      `Correct the value for '${input.name}' and try again.`,
    );
  }
}

/**
 * Legacy enum validation (for backward compatibility with string[] options).
 */
function validateEnumLegacy(
  value: unknown,
  options: readonly EnumOption[],
  inputName: string,
): void {
  const validValues = getEnumValues(options);
  if (!validValues.includes(String(value))) {
    throw new ScaffoldError(
      `Input '${inputName}' value '${value}' is not valid. Allowed values: ${validValues.join(", ")}`,
      "INPUT_ENUM_ERROR",
    );
  }
}

// =============================================================================
// Core Resolution
// =============================================================================

/**
 * Resolves inputs based on schema, provided values, and defaults.
 *
 * ## Resolution Priority
 * 1. Provided values (highest priority)
 * 2. Default values from schema
 * 3. Prompt user (interactive mode only)
 * 4. Omit optional inputs without defaults
 *
 * ## Conditional Inputs (when clause)
 * Inputs with a `when` clause are only included if the condition is met.
 * The condition checks if another input equals a specific value.
 *
 * ## Non-Interactive Mode (--yes)
 * When `nonInteractive` is true:
 * - Never calls prompt adapter
 * - Uses provided values and defaults only
 * - Throws error if required input has no value
 *
 * @param params - Resolution parameters
 * @returns Resolved input values
 * @throws ScaffoldError if required inputs are missing or validation fails
 */
export async function resolveInputs(
  params: ResolveInputsParams,
): Promise<Record<string, unknown>> {
  const { inputsSchema, nonInteractive, prompt, provided = {}, archetypeRef } = params;

  // No inputs defined - return provided values as-is (backward compatibility)
  if (!inputsSchema || inputsSchema.length === 0) {
    return { ...provided };
  }

  const result: Record<string, unknown> = {};
  const missingRequired: string[] = [];

  for (const input of inputsSchema) {
    const { name, type, required, default: defaultValue, options } = input;

    // Check if conditional input should be skipped
    if (input.when && !isConditionMet(input.when, result)) {
      // Skip this input - condition not met
      continue;
    }

    // Check if value was provided
    if (name in provided) {
      const coerced = coerceValue(provided[name], type, name);

      // Validate with enhanced validation
      validateValue(coerced, input);

      // Additional enum validation (backward compat)
      if (type === "enum" && options) {
        validateEnumLegacy(coerced, options, name);
      }

      result[name] = coerced;
      continue;
    }

    // Check if default exists
    if (defaultValue !== undefined) {
      const coerced = coerceValue(defaultValue, type, name);

      // Validate with enhanced validation
      validateValue(coerced, input);

      // Additional enum validation (backward compat)
      if (type === "enum" && options) {
        validateEnumLegacy(coerced, options, name);
      }

      result[name] = coerced;
      continue;
    }

    // No provided value, no default - what now?
    if (required) {
      if (nonInteractive) {
        // Non-interactive mode: collect missing required inputs
        missingRequired.push(name);
      } else {
        // Interactive mode: prompt the user
        if (!prompt) {
          throw new ScaffoldError(
            "Prompt adapter required for interactive mode with missing required inputs",
            "PROMPT_ADAPTER_REQUIRED",
          );
        }

        const userValue = await prompt.prompt(input);
        const coerced = coerceValue(userValue, type, name);

        // Validate with enhanced validation
        validateValue(coerced, input);

        // Additional enum validation (backward compat)
        if (type === "enum" && options) {
          validateEnumLegacy(coerced, options, name);
        }

        result[name] = coerced;
      }
    }
    // Optional input without default: omit from result
  }

  // If there are missing required inputs in non-interactive mode, throw error
  if (missingRequired.length > 0) {
    const inputList = missingRequired.join(", ");
    throw new ScaffoldError(
      `Missing required input${missingRequired.length > 1 ? "s" : ""}: ${inputList}. ` +
        `No default${missingRequired.length > 1 ? "s" : ""} defined.`,
      "MISSING_REQUIRED_INPUTS",
      archetypeRef ? { archetypeRef } : undefined, // details
      undefined, // data
      "Run without --yes to be prompted for values, or add defaults to the manifest.", // hint
    );
  }

  return result;
}
