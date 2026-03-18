/**
 * Input Value Transformers.
 *
 * Provides built-in string transformers that can be applied to input values
 * before they are passed to Handlebars templates.
 *
 * Transformers are declared in archetype.yaml under each input:
 *
 * ```yaml
 * inputs:
 *   - name: entityName
 *     type: string
 *     required: true
 *     transforms:
 *       - camelCase     # entityName → entityName (as camelCase)
 *       - PascalCase    # as PascalCase → EntityName
 *       - kebab-case    # as kebab-case → entity-name
 *       - snake_case    # as snake_case → entity_name
 *       - UPPER_SNAKE   # as UPPER_SNAKE → ENTITY_NAME
 *       - lower         # lowercase
 *       - upper         # UPPERCASE
 * ```
 *
 * When `transforms` is specified on an input, the original value is kept
 * AND additional template variables are added:
 *   entityName          → original value
 *   entityNameCamelCase → camelCase transformation
 *   entityNamePascalCase → PascalCase transformation
 *   etc.
 *
 * @module
 */

// =============================================================================
// Transform Functions
// =============================================================================

/** Splits a string into words by common delimiters and case boundaries. */
function splitWords(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // XMLParser → XML Parser
    .split(/[\s_\-./\\]+/) // split by delimiters
    .map((w) => w.trim())
    .filter(Boolean);
}

export const TRANSFORMERS: Record<string, (value: string) => string> = {
  /** camelCase: entityName */
  camelCase: (v) => {
    const words = splitWords(v);
    if (words.length === 0) return v;
    return (
      words[0].toLowerCase() +
      words
        .slice(1)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join("")
    );
  },

  /** PascalCase: EntityName */
  PascalCase: (v) => {
    const words = splitWords(v);
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  },

  /** kebab-case: entity-name */
  "kebab-case": (v) => splitWords(v).map((w) => w.toLowerCase()).join("-"),

  /** snake_case: entity_name */
  snake_case: (v) => splitWords(v).map((w) => w.toLowerCase()).join("_"),

  /** UPPER_SNAKE: ENTITY_NAME */
  UPPER_SNAKE: (v) => splitWords(v).map((w) => w.toUpperCase()).join("_"),

  /** lower: entityname */
  lower: (v) => v.toLowerCase(),

  /** upper: ENTITYNAME */
  upper: (v) => v.toUpperCase(),

  /** title: Entity Name */
  title: (v) =>
    splitWords(v)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" "),

  /** dot.case: entity.name */
  "dot.case": (v) => splitWords(v).map((w) => w.toLowerCase()).join("."),

  /** path/case: entity/name */
  "path/case": (v) => splitWords(v).map((w) => w.toLowerCase()).join("/"),
};

// =============================================================================
// Apply Transforms
// =============================================================================

/**
 * Applies a list of named transforms to a string value.
 *
 * @param value - The input value to transform
 * @param transforms - Array of transformer names
 * @returns Map of transform name → transformed value
 */
export function applyTransforms(
  value: string,
  transforms: string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const name of transforms) {
    const fn = TRANSFORMERS[name];
    if (fn) {
      result[name] = fn(value);
    }
  }

  return result;
}

/**
 * Expands input data by applying transforms and injecting derived variables.
 *
 * For each input that has `transforms`, adds additional keys to the data object:
 *   `${inputName}_${transformName}` (with symbols replaced by underscores)
 *
 * @example
 * Input: { entityName: "userAccount", transforms: ["PascalCase", "kebab-case"] }
 * Output additions:
 *   entityName_PascalCase → "UserAccount"
 *   entityName_kebab_case → "user-account"
 *
 * @param data - Resolved input data
 * @param inputDefs - Input definitions with optional transforms
 * @returns Expanded data with transform variables added
 */
export function expandWithTransforms(
  data: Record<string, unknown>,
  inputDefs: Array<{ name: string; transforms?: string[] }>,
): Record<string, unknown> {
  const expanded = { ...data };

  for (const def of inputDefs) {
    if (!def.transforms || def.transforms.length === 0) continue;

    const value = data[def.name];
    if (typeof value !== "string") continue;

    const transformed = applyTransforms(value, def.transforms);
    for (const [transformName, transformedValue] of Object.entries(transformed)) {
      // Key: inputName_transformName (replace non-alphanum with underscore)
      const key = `${def.name}_${transformName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      expanded[key] = transformedValue;
    }
  }

  return expanded;
}
