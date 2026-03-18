/**
 * When-Clause Evaluator.
 *
 * Evaluates conditional `when` clauses from archetype input definitions.
 * Used to decide whether an input should be shown/required based on
 * the current values of other inputs.
 *
 * Supported operators:
 *   { input: "x", equals: "value" }        — x === value
 *   { input: "x", notEquals: "value" }     — x !== value
 *   { input: "x", in: ["a", "b"] }         — x is one of the values
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export interface WhenEquals {
  readonly input: string;
  readonly equals: string | number | boolean;
}

export interface WhenNotEquals {
  readonly input: string;
  readonly notEquals: string | number | boolean;
}

export interface WhenIn {
  readonly input: string;
  readonly in: Array<string | number | boolean>;
}

export type WhenClause = WhenEquals | WhenNotEquals | WhenIn;

// =============================================================================
// Evaluator
// =============================================================================

/**
 * Evaluates a when clause against the current input data.
 *
 * @param clause - The when clause to evaluate
 * @param data - Current resolved input values
 * @returns true if the condition is satisfied (input should be shown/required)
 */
export function evaluateWhen(
  clause: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!clause) return true;

  const inputName = clause.input as string;
  if (!inputName) return true;

  const currentValue = data[inputName];

  // equals operator
  if ("equals" in clause) {
    return currentValue === clause.equals;
  }

  // notEquals operator
  if ("notEquals" in clause) {
    return currentValue !== clause.notEquals;
  }

  // in operator
  if ("in" in clause && Array.isArray(clause.in)) {
    return (clause.in as unknown[]).includes(currentValue);
  }

  return true;
}

/**
 * Filters an input definition list to those whose when clause is satisfied.
 *
 * @param inputs - Full list of input definitions
 * @param data - Current resolved input values
 * @returns Inputs whose when clause is satisfied (or that have no when clause)
 */
export function filterActiveInputs<T extends { when?: Record<string, unknown> }>(
  inputs: T[],
  data: Record<string, unknown>,
): T[] {
  return inputs.filter((input) => evaluateWhen(input.when, data));
}
