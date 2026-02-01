/**
 * Standardized error codes for Scaffoldix.
 *
 * Error codes are stable public API contracts. They should be:
 * - SCREAMING_SNAKE_CASE
 * - Grouped by domain
 * - Documented in docs/errors.md
 *
 * @module
 */

// =============================================================================
// Error Code Enum
// =============================================================================

/**
 * All official Scaffoldix error codes.
 *
 * Codes are grouped by domain:
 * - PACK_* : Pack operations (add, remove, list)
 * - MANIFEST_* : Manifest loading and validation
 * - ARCHETYPE_* : Archetype selection
 * - INPUT_* : User input validation
 * - TEMPLATE_* : Template rendering
 * - OUTPUT_* : Output file operations
 * - PATCH_* : Patch operations
 * - HOOK_* : Hook execution
 * - CHECK_* : Check command execution
 * - STATE_* : Project state operations
 * - FS_* : Filesystem operations
 * - GIT_* : Git operations
 * - STAGING_* : Staging operations
 * - INTERNAL_* : Internal errors
 */
export const ErrorCode = {
  // Pack errors (10-19)
  PACK_NOT_FOUND: "PACK_NOT_FOUND",
  PACK_INVALID: "PACK_INVALID",
  PACK_ALREADY_INSTALLED: "PACK_ALREADY_INSTALLED",
  PACK_NOT_INSTALLED: "PACK_NOT_INSTALLED",
  PACK_FETCH_FAILED: "PACK_FETCH_FAILED",
  PACK_STORE_FAILED: "PACK_STORE_FAILED",

  // Manifest errors (20-29)
  MANIFEST_NOT_FOUND: "MANIFEST_NOT_FOUND",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_PARSE_FAILED: "MANIFEST_PARSE_FAILED",
  MANIFEST_INVALID_PATH: "MANIFEST_INVALID_PATH",

  // Archetype errors (20-29, same category)
  ARCHETYPE_NOT_FOUND: "ARCHETYPE_NOT_FOUND",

  // Input errors (30-39)
  INPUT_VALIDATION_FAILED: "INPUT_VALIDATION_FAILED",
  INPUT_REQUIRED: "INPUT_REQUIRED",
  INPUT_INVALID_TYPE: "INPUT_INVALID_TYPE",

  // Template/render errors (30-39)
  TEMPLATE_RENDER_FAILED: "TEMPLATE_RENDER_FAILED",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  TEMPLATE_SYNTAX_ERROR: "TEMPLATE_SYNTAX_ERROR",

  // Output/conflict errors (30-39)
  OUTPUT_CONFLICT: "OUTPUT_CONFLICT",
  OUTPUT_WRITE_FAILED: "OUTPUT_WRITE_FAILED",

  // Patch errors (40-49)
  PATCH_MARKER_NOT_FOUND: "PATCH_MARKER_NOT_FOUND",
  PATCH_APPLY_FAILED: "PATCH_APPLY_FAILED",
  PATCH_FILE_NOT_FOUND: "PATCH_FILE_NOT_FOUND",
  PATCH_INVALID: "PATCH_INVALID",

  // Hook errors (50-59)
  HOOK_FAILED: "HOOK_FAILED",
  HOOK_TIMEOUT: "HOOK_TIMEOUT",
  CHECK_FAILED: "CHECK_FAILED",

  // State errors (60-69)
  STATE_READ_FAILED: "STATE_READ_FAILED",
  STATE_WRITE_FAILED: "STATE_WRITE_FAILED",
  STATE_MIGRATION_FAILED: "STATE_MIGRATION_FAILED",
  STATE_INVALID: "STATE_INVALID",

  // Filesystem errors (70-79)
  FS_PERMISSION_DENIED: "FS_PERMISSION_DENIED",
  FS_NOT_FOUND: "FS_NOT_FOUND",
  FS_ALREADY_EXISTS: "FS_ALREADY_EXISTS",
  FS_NOT_DIRECTORY: "FS_NOT_DIRECTORY",

  // Git errors (80-89)
  GIT_CLONE_FAILED: "GIT_CLONE_FAILED",
  GIT_REF_NOT_FOUND: "GIT_REF_NOT_FOUND",
  GIT_INVALID_URL: "GIT_INVALID_URL",

  // Staging errors (30-39)
  STAGING_FAILED: "STAGING_FAILED",
  STAGING_COMMIT_FAILED: "STAGING_COMMIT_FAILED",

  // Internal errors (1)
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// Error Categories
// =============================================================================

/**
 * Error category for grouping related errors.
 */
export type ErrorCategory =
  | "pack"
  | "manifest"
  | "input"
  | "generation"
  | "patch"
  | "hook"
  | "state"
  | "fs"
  | "git"
  | "internal";

/**
 * Gets the category for an error code.
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  if (code.startsWith("PACK_")) return "pack";
  if (code.startsWith("MANIFEST_") || code.startsWith("ARCHETYPE_"))
    return "manifest";
  if (code.startsWith("INPUT_")) return "input";
  if (
    code.startsWith("TEMPLATE_") ||
    code.startsWith("OUTPUT_") ||
    code.startsWith("STAGING_")
  )
    return "generation";
  if (code.startsWith("PATCH_")) return "patch";
  if (code.startsWith("HOOK_") || code.startsWith("CHECK_")) return "hook";
  if (code.startsWith("STATE_")) return "state";
  if (code.startsWith("FS_")) return "fs";
  if (code.startsWith("GIT_")) return "git";
  return "internal";
}

// =============================================================================
// Exit Codes
// =============================================================================

/**
 * Exit code ranges by category:
 * - 1: Internal/generic error
 * - 10-19: Pack errors
 * - 20-29: Manifest/archetype errors
 * - 30-39: Generation/input/template/output errors
 * - 40-49: Patch errors
 * - 50-59: Hook/check errors
 * - 60-69: State errors
 * - 70-79: Filesystem errors
 * - 80-89: Git errors
 */
const EXIT_CODE_MAP: Record<ErrorCode, number> = {
  // Pack errors (10-19)
  [ErrorCode.PACK_NOT_FOUND]: 10,
  [ErrorCode.PACK_INVALID]: 11,
  [ErrorCode.PACK_ALREADY_INSTALLED]: 12,
  [ErrorCode.PACK_NOT_INSTALLED]: 13,
  [ErrorCode.PACK_FETCH_FAILED]: 14,
  [ErrorCode.PACK_STORE_FAILED]: 15,

  // Manifest errors (20-29)
  [ErrorCode.MANIFEST_NOT_FOUND]: 20,
  [ErrorCode.MANIFEST_INVALID]: 21,
  [ErrorCode.MANIFEST_PARSE_FAILED]: 22,
  [ErrorCode.MANIFEST_INVALID_PATH]: 23,
  [ErrorCode.ARCHETYPE_NOT_FOUND]: 24,

  // Generation/input/template/output errors (30-39)
  [ErrorCode.INPUT_VALIDATION_FAILED]: 30,
  [ErrorCode.INPUT_REQUIRED]: 31,
  [ErrorCode.INPUT_INVALID_TYPE]: 32,
  [ErrorCode.TEMPLATE_RENDER_FAILED]: 33,
  [ErrorCode.TEMPLATE_NOT_FOUND]: 34,
  [ErrorCode.TEMPLATE_SYNTAX_ERROR]: 35,
  [ErrorCode.OUTPUT_CONFLICT]: 36,
  [ErrorCode.OUTPUT_WRITE_FAILED]: 37,
  [ErrorCode.STAGING_FAILED]: 38,
  [ErrorCode.STAGING_COMMIT_FAILED]: 39,

  // Patch errors (40-49)
  [ErrorCode.PATCH_MARKER_NOT_FOUND]: 40,
  [ErrorCode.PATCH_APPLY_FAILED]: 41,
  [ErrorCode.PATCH_FILE_NOT_FOUND]: 42,
  [ErrorCode.PATCH_INVALID]: 43,

  // Hook/check errors (50-59)
  [ErrorCode.HOOK_FAILED]: 50,
  [ErrorCode.HOOK_TIMEOUT]: 51,
  [ErrorCode.CHECK_FAILED]: 52,

  // State errors (60-69)
  [ErrorCode.STATE_READ_FAILED]: 60,
  [ErrorCode.STATE_WRITE_FAILED]: 61,
  [ErrorCode.STATE_MIGRATION_FAILED]: 62,
  [ErrorCode.STATE_INVALID]: 63,

  // Filesystem errors (70-79)
  [ErrorCode.FS_PERMISSION_DENIED]: 70,
  [ErrorCode.FS_NOT_FOUND]: 71,
  [ErrorCode.FS_ALREADY_EXISTS]: 72,
  [ErrorCode.FS_NOT_DIRECTORY]: 73,

  // Git errors (80-89)
  [ErrorCode.GIT_CLONE_FAILED]: 80,
  [ErrorCode.GIT_REF_NOT_FOUND]: 81,
  [ErrorCode.GIT_INVALID_URL]: 82,

  // Internal errors (1)
  [ErrorCode.INTERNAL_ERROR]: 1,
};

/**
 * Gets the exit code for an error code.
 */
export function getExitCode(code: ErrorCode): number {
  return EXIT_CODE_MAP[code] ?? 1;
}
