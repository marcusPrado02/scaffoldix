/**
 * Patch Conflict Detector.
 *
 * Detects conflicts between patch operations before they are applied.
 * A conflict occurs when multiple patches target the same file marker
 * or share an idempotency key, which would produce unpredictable results.
 *
 * ## Detected Conflicts
 *
 * 1. **Duplicate idempotency key**: Two patches with the same `idempotencyKey`
 *    — the second would always be skipped, hiding bugs in manifest authoring.
 *
 * 2. **Marker conflict**: Two marker-based patches (`marker_insert` /
 *    `marker_replace`) target the same `file` + `markerStart` pair. Both would
 *    read the file before the other writes, producing corrupted output.
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal patch shape needed for conflict analysis.
 */
export interface AnalyzablePatch {
  readonly kind: string;
  readonly file: string;
  readonly idempotencyKey: string;
  readonly markerStart?: string;
}

/**
 * A single conflict between two patches.
 */
export interface PatchConflict {
  /** Type of conflict detected */
  readonly type: "duplicate_idempotency_key" | "marker_conflict";

  /** Human-readable description */
  readonly message: string;

  /** Index of the first patch (in the ordered list) */
  readonly patchAIndex: number;

  /** Index of the second patch (in the ordered list) */
  readonly patchBIndex: number;

  /** Idempotency key of patchA */
  readonly patchAKey: string;

  /** Idempotency key of patchB */
  readonly patchBKey: string;

  /** The shared file path */
  readonly file: string;
}

/**
 * Result of conflict detection.
 */
export interface PatchConflictReport {
  /** True if any conflicts were found */
  readonly hasConflicts: boolean;

  /** List of detected conflicts */
  readonly conflicts: PatchConflict[];
}

// =============================================================================
// Detector
// =============================================================================

/**
 * Analyzes a list of patch operations for conflicts.
 *
 * @param patches - Ordered list of patches to analyse
 * @returns Conflict report
 */
export function detectPatchConflicts(patches: AnalyzablePatch[]): PatchConflictReport {
  const conflicts: PatchConflict[] = [];

  // Track seen idempotency keys: key -> first index
  const seenKeys = new Map<string, number>();

  // Track seen marker targets: "file::markerStart" -> first index
  const seenMarkers = new Map<string, number>();

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];

    // 1. Duplicate idempotency key check
    const existingKeyIdx = seenKeys.get(patch.idempotencyKey);
    if (existingKeyIdx !== undefined) {
      conflicts.push({
        type: "duplicate_idempotency_key",
        message:
          `Patches at index ${existingKeyIdx} and ${i} share idempotencyKey ` +
          `"${patch.idempotencyKey}" on file "${patch.file}". ` +
          `The second patch will always be skipped.`,
        patchAIndex: existingKeyIdx,
        patchBIndex: i,
        patchAKey: patches[existingKeyIdx].idempotencyKey,
        patchBKey: patch.idempotencyKey,
        file: patch.file,
      });
    } else {
      seenKeys.set(patch.idempotencyKey, i);
    }

    // 2. Marker conflict check (only for marker-based operations)
    if (
      (patch.kind === "marker_insert" || patch.kind === "marker_replace") &&
      patch.markerStart
    ) {
      const markerKey = `${patch.file}::${patch.markerStart}`;
      const existingMarkerIdx = seenMarkers.get(markerKey);
      if (existingMarkerIdx !== undefined) {
        conflicts.push({
          type: "marker_conflict",
          message:
            `Patches at index ${existingMarkerIdx} ("${patches[existingMarkerIdx].idempotencyKey}") ` +
            `and ${i} ("${patch.idempotencyKey}") both target marker ` +
            `"${patch.markerStart}" in file "${patch.file}". ` +
            `This may produce corrupted output.`,
          patchAIndex: existingMarkerIdx,
          patchBIndex: i,
          patchAKey: patches[existingMarkerIdx].idempotencyKey,
          patchBKey: patch.idempotencyKey,
          file: patch.file,
        });
      } else {
        seenMarkers.set(markerKey, i);
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}
