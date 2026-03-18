/**
 * CLI Version Module.
 *
 * Exports the current Scaffoldix CLI version, injected at build time
 * from package.json via tsup's define option. Falls back to the
 * hardcoded value when running directly from source (e.g., in tests).
 *
 * @module
 */

declare const __SCAFFOLDIX_VERSION__: string;

/**
 * Current Scaffoldix CLI version, injected from package.json at build time.
 */
export const CLI_VERSION: string =
  typeof __SCAFFOLDIX_VERSION__ !== "undefined" ? __SCAFFOLDIX_VERSION__ : "0.1.0";
