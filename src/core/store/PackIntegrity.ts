/**
 * Pack Integrity Module.
 *
 * Provides SHA-256 content hashing and optional verification for installed packs.
 *
 * ## How it works
 *
 * When a pack is installed, a `.scaffoldix-integrity` file is written to the
 * pack's store directory containing:
 *   - SHA-256 hashes of every file in the pack
 *   - A manifest hash (hash of all file hashes combined)
 *   - Timestamp and pack metadata
 *
 * Before generating from a pack, the integrity can be verified by recomputing
 * file hashes and comparing against the stored manifest.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import fg from "fast-glob";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Types
// =============================================================================

export interface FileHash {
  readonly relativePath: string;
  readonly sha256: string;
  readonly size: number;
}

export interface IntegrityManifest {
  readonly version: 1;
  readonly packId: string;
  readonly packVersion: string;
  readonly createdAt: string;
  readonly manifestHash: string;
  readonly files: FileHash[];
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly missing: string[];
  readonly modified: string[];
  readonly extra: string[];
}

const INTEGRITY_FILE = ".scaffoldix-integrity.json";

// =============================================================================
// Functions
// =============================================================================

/**
 * Computes SHA-256 hash of a file's contents.
 */
async function hashFile(filePath: string): Promise<{ sha256: string; size: number }> {
  const content = await fs.readFile(filePath);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  return { sha256, size: content.length };
}

/**
 * Computes a combined manifest hash from all file hashes.
 * Sorted by path to ensure deterministic ordering.
 */
function computeManifestHash(files: FileHash[]): string {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const combined = sorted.map((f) => `${f.relativePath}:${f.sha256}`).join("\n");
  return crypto.createHash("sha256").update(combined).digest("hex");
}

/**
 * Writes an integrity manifest for an installed pack directory.
 *
 * @param packDir - Absolute path to the installed pack directory
 * @param packId - Pack identifier
 * @param packVersion - Pack version string
 */
export async function writeIntegrityManifest(
  packDir: string,
  packId: string,
  packVersion: string,
): Promise<IntegrityManifest> {
  const allFiles = await fg("**/*", {
    cwd: packDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [INTEGRITY_FILE],
  });

  const fileHashes: FileHash[] = [];
  for (const relativePath of allFiles.sort()) {
    const absPath = path.join(packDir, relativePath);
    const { sha256, size } = await hashFile(absPath);
    fileHashes.push({ relativePath, sha256, size });
  }

  const manifest: IntegrityManifest = {
    version: 1,
    packId,
    packVersion,
    createdAt: new Date().toISOString(),
    manifestHash: computeManifestHash(fileHashes),
    files: fileHashes,
  };

  const integrityPath = path.join(packDir, INTEGRITY_FILE);
  await fs.writeFile(integrityPath, JSON.stringify(manifest, null, 2), "utf-8");

  return manifest;
}

/**
 * Reads the integrity manifest from a pack directory.
 *
 * @param packDir - Absolute path to the installed pack directory
 * @returns Parsed integrity manifest, or null if not found
 */
export async function readIntegrityManifest(packDir: string): Promise<IntegrityManifest | null> {
  const integrityPath = path.join(packDir, INTEGRITY_FILE);
  try {
    const raw = await fs.readFile(integrityPath, "utf-8");
    return JSON.parse(raw) as IntegrityManifest;
  } catch {
    return null;
  }
}

/**
 * Verifies a pack directory against its stored integrity manifest.
 *
 * @param packDir - Absolute path to the installed pack directory
 * @returns Verification result with lists of missing, modified, and extra files
 * @throws ScaffoldError if no integrity manifest is found
 */
export async function verifyPackIntegrity(packDir: string): Promise<VerifyResult> {
  const stored = await readIntegrityManifest(packDir);

  if (!stored) {
    throw new ScaffoldError(
      `No integrity manifest found for pack at ${packDir}`,
      "PACK_NO_INTEGRITY_MANIFEST",
      { packDir },
      undefined,
      `The pack at "${packDir}" has no integrity manifest. ` +
        `Re-install the pack with \`scaffoldix pack add\` to create one.`,
      undefined,
      true,
    );
  }

  const currentFiles = await fg("**/*", {
    cwd: packDir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [INTEGRITY_FILE],
  });

  const storedMap = new Map(stored.files.map((f) => [f.relativePath, f]));
  const currentSet = new Set(currentFiles);

  const missing: string[] = [];
  const modified: string[] = [];
  const extra: string[] = [];

  // Check all stored files
  for (const storedFile of stored.files) {
    if (!currentSet.has(storedFile.relativePath)) {
      missing.push(storedFile.relativePath);
    } else {
      const absPath = path.join(packDir, storedFile.relativePath);
      const { sha256 } = await hashFile(absPath);
      if (sha256 !== storedFile.sha256) {
        modified.push(storedFile.relativePath);
      }
    }
  }

  // Check for extra files not in manifest
  for (const currentFile of currentFiles) {
    if (!storedMap.has(currentFile)) {
      extra.push(currentFile);
    }
  }

  return {
    valid: missing.length === 0 && modified.length === 0,
    missing,
    modified,
    extra,
  };
}
