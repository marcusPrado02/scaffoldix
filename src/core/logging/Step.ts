/**
 * Pipeline step identifiers for structured logging.
 *
 * Steps represent major phases in the Scaffoldix execution pipeline.
 * They are used for:
 * - Log context enrichment
 * - Timeline reconstruction
 * - Performance tracking
 *
 * @module
 */

/**
 * All pipeline step names.
 *
 * Steps follow a dotted naming convention: `<domain>.<action>`
 */
export const Step = {
  /** CLI initialization */
  CLI_INIT: "cli.init",

  /** Loading pack from store/registry */
  PACK_LOAD: "pack.load",

  /** Loading and parsing manifest */
  MANIFEST_LOAD: "manifest.load",

  /** Resolving user inputs */
  INPUTS_RESOLVE: "inputs.resolve",

  /** Building render/generation plan */
  PLAN_BUILD: "plan.build",

  /** Rendering templates and writing files */
  RENDER: "render",

  /** Applying patches to files */
  PATCH_APPLY: "patch.apply",

  /** Running lifecycle hooks */
  HOOKS_RUN: "hooks.run",

  /** Running check commands */
  CHECKS_RUN: "checks.run",

  /** Writing project state */
  STATE_WRITE: "state.write",

  /** Execution complete */
  DONE: "done",

  /** Computing preview (dry-run) */
  PREVIEW: "preview",

  /** Detecting conflicts */
  CONFLICTS: "conflicts",

  /** Staging files */
  STAGING: "staging",
} as const;

export type Step = (typeof Step)[keyof typeof Step];
