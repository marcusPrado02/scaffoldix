/**
 * Input Validator module for validating input values at runtime.
 *
 * Validates inputs against their schema definitions with support for:
 * - String: minLength, maxLength, regex
 * - Number: min, max, integer
 * - Enum: value must be in options
 * - Custom error messages
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Custom messages for validation errors.
 */
export interface ValidationMessages {
  readonly required?: string;
  readonly invalid?: string;
  readonly min?: string;
  readonly max?: string;
  readonly minLength?: string;
  readonly maxLength?: string;
  readonly regex?: string;
  readonly integer?: string;
}

/**
 * Enum option can be a string or object with value/label.
 */
export type EnumOption = string | { readonly value: string; readonly label?: string };

/**
 * Enhanced input definition with validation fields.
 */
export interface EnhancedInputDefinition {
  readonly name: string;
  readonly type: "string" | "number" | "boolean" | "enum";
  readonly required?: boolean;
  readonly default?: unknown;
  readonly prompt?: string;
  readonly description?: string;

  // String validations
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly regex?: string;

  // Number validations
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;

  // Enum options (string array or object array)
  readonly options?: readonly EnumOption[];

  // Custom messages
  readonly messages?: ValidationMessages;

  // Conditional display
  readonly when?: {
    readonly input: string;
    readonly equals: string | number | boolean;
  };
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extracts the value from an enum option.
 */
export function getEnumValue(option: EnumOption): string {
  return typeof option === "string" ? option : option.value;
}

/**
 * Gets all valid values from enum options.
 */
export function getEnumValues(options: readonly EnumOption[]): string[] {
  return options.map(getEnumValue);
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates a string value.
 */
function validateString(
  value: unknown,
  def: EnhancedInputDefinition,
): ValidationResult {
  const str = String(value);

  // Check required (empty string counts as missing)
  if (def.required && str.trim() === "") {
    return {
      valid: false,
      message: def.messages?.required ?? `Input '${def.name}' is required`,
    };
  }

  // Skip validation for empty optional strings
  if (str.trim() === "" && !def.required) {
    return { valid: true };
  }

  // minLength
  if (def.minLength !== undefined && str.length < def.minLength) {
    return {
      valid: false,
      message:
        def.messages?.minLength ??
        `Input '${def.name}' must be at least ${def.minLength} characters`,
    };
  }

  // maxLength
  if (def.maxLength !== undefined && str.length > def.maxLength) {
    return {
      valid: false,
      message:
        def.messages?.maxLength ??
        `Input '${def.name}' must be at most ${def.maxLength} characters`,
    };
  }

  // regex
  if (def.regex !== undefined) {
    const pattern = new RegExp(def.regex);
    if (!pattern.test(str)) {
      return {
        valid: false,
        message: def.messages?.regex ?? `Input '${def.name}' does not match required format`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a number value.
 */
function validateNumber(
  value: unknown,
  def: EnhancedInputDefinition,
): ValidationResult {
  const num = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(num)) {
    return {
      valid: false,
      message: def.messages?.invalid ?? `Input '${def.name}' is not a valid number`,
    };
  }

  // integer constraint
  if (def.integer && !Number.isInteger(num)) {
    return {
      valid: false,
      message: def.messages?.integer ?? `Input '${def.name}' must be an integer`,
    };
  }

  // min
  if (def.min !== undefined && num < def.min) {
    return {
      valid: false,
      message: def.messages?.min ?? `Input '${def.name}' must be at least ${def.min}`,
    };
  }

  // max
  if (def.max !== undefined && num > def.max) {
    return {
      valid: false,
      message: def.messages?.max ?? `Input '${def.name}' must be at most ${def.max}`,
    };
  }

  return { valid: true };
}

/**
 * Validates an enum value.
 */
function validateEnum(
  value: unknown,
  def: EnhancedInputDefinition,
): ValidationResult {
  if (!def.options || def.options.length === 0) {
    return {
      valid: false,
      message: `Input '${def.name}' has no valid options defined`,
    };
  }

  const validValues = getEnumValues(def.options);
  const strValue = String(value);

  if (!validValues.includes(strValue)) {
    return {
      valid: false,
      message:
        def.messages?.invalid ??
        `Input '${def.name}' must be one of: ${validValues.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Validates a boolean value.
 */
function validateBoolean(
  value: unknown,
  def: EnhancedInputDefinition,
): ValidationResult {
  if (typeof value === "boolean") {
    return { valid: true };
  }

  const str = String(value).toLowerCase();
  if (str === "true" || str === "false") {
    return { valid: true };
  }

  return {
    valid: false,
    message: def.messages?.invalid ?? `Input '${def.name}' must be true or false`,
  };
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Validates an input value against its definition.
 *
 * @param value - The value to validate
 * @param def - The input definition with validation rules
 * @returns Validation result with valid flag and optional error message
 */
export function validateInput(
  value: unknown,
  def: EnhancedInputDefinition,
): ValidationResult {
  switch (def.type) {
    case "string":
      return validateString(value, def);
    case "number":
      return validateNumber(value, def);
    case "boolean":
      return validateBoolean(value, def);
    case "enum":
      return validateEnum(value, def);
    default:
      return { valid: true };
  }
}

/**
 * Checks if a 'when' condition is satisfied.
 *
 * @param when - The when clause from input definition
 * @param resolvedInputs - Already resolved input values
 * @returns true if condition is met (or no condition), false otherwise
 */
export function isConditionMet(
  when: EnhancedInputDefinition["when"],
  resolvedInputs: Record<string, unknown>,
): boolean {
  if (!when) {
    return true;
  }

  const dependentValue = resolvedInputs[when.input];
  return dependentValue === when.equals;
}

/**
 * Validates a regex pattern is compilable.
 *
 * @param pattern - The regex pattern string
 * @returns true if valid, false otherwise
 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
