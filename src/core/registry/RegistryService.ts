/**
 * Registry Service for Scaffoldix CLI.
 *
 * The Registry tracks all installed packs in the Store. It is the single source
 * of truth for what packs are available locally and where they came from.
 *
 * ## Registry Location
 *
 * The registry file (`registry.json`) lives inside the Store directory.
 * Its path is provided by the Store paths module - this service never
 * constructs paths itself.
 *
 * ## Safety Guarantees
 *
 * - **load()** never throws for missing file (returns empty registry)
 * - **save()** uses atomic write (temp file + rename) to prevent corruption
 * - **registerPack()** is idempotent (same input = same result)
 *
 * ## Schema Versioning
 *
 * The registry includes a `schemaVersion` field for future migrations.
 * When the schema changes, we can detect old registries and migrate them.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { z } from "zod";
import { ScaffoldError } from "../errors/errors.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Current registry schema version.
 * Increment when making breaking changes to the registry format.
 */
export const REGISTRY_SCHEMA_VERSION = 1;

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Schema for pack origin - where the pack was installed from.
 *
 * Supports multiple origin types:
 * - local: installed from a local directory
 * - git: cloned from a git repository
 * - zip: downloaded from a URL (zip archive)
 * - npm: installed from npm registry (future)
 */
const PackOriginLocalSchema = z.object({
  type: z.literal("local"),
  localPath: z.string().min(1),
});

const PackOriginGitSchema = z.object({
  type: z.literal("git"),
  gitUrl: z.string().min(1), // URL or local path (for testing)
  ref: z.string().optional(), // branch, tag, or commit
  commit: z.string().optional(), // resolved commit SHA
});

const PackOriginZipSchema = z.object({
  type: z.literal("zip"),
  zipUrl: z.url(),
});

const PackOriginNpmSchema = z.object({
  type: z.literal("npm"),
  packageName: z.string().min(1),
  registry: z.url().optional(), // custom registry URL
});

const PackOriginSchema = z.discriminatedUnion("type", [
  PackOriginLocalSchema,
  PackOriginGitSchema,
  PackOriginZipSchema,
  PackOriginNpmSchema,
]);

/**
 * Schema for a single pack install record (current or historical).
 */
const PackInstallRecordSchema = z.object({
  /** Semantic version string (e.g., "1.0.0", "2.3.1-beta.1") */
  version: z.string().min(1),

  /** Where the pack was installed from */
  origin: PackOriginSchema,

  /** SHA-256 hash of pack contents for integrity verification */
  hash: z.string().regex(/^[a-f0-9]{64}$/, "Must be a valid SHA-256 hash"),

  /** ISO 8601 timestamp of when the pack was installed */
  installedAt: z.iso.datetime(),
});

/**
 * Schema for a single pack entry in the registry.
 * Includes optional history for tracking updates.
 */
const RegistryPackEntrySchema = z.object({
  /** Unique pack identifier (e.g., "react-starter", "@org/pack-name") */
  id: z.string().min(1),

  /** Semantic version string (e.g., "1.0.0", "2.3.1-beta.1") */
  version: z.string().min(1),

  /** Where the pack was installed from */
  origin: PackOriginSchema,

  /** SHA-256 hash of pack contents for integrity verification */
  hash: z.string().regex(/^[a-f0-9]{64}$/, "Must be a valid SHA-256 hash"),

  /** ISO 8601 timestamp of when the pack was installed */
  installedAt: z.iso.datetime(),

  /** History of previous installations (oldest first). Added in schema v2. */
  history: z.array(PackInstallRecordSchema).optional(),

  /**
   * Multiple installed versions of this pack.
   * When present, version/origin/hash/installedAt above represent the "default" version,
   * but any version in this array can be selected via --version flag.
   * Added for multi-version support.
   */
  installs: z.array(PackInstallRecordSchema).optional(),
});

/**
 * Schema for the full registry file.
 */
const RegistrySchema = z.object({
  /** Schema version for migration support */
  schemaVersion: z.number().int().positive(),

  /** Dictionary of installed packs, keyed by pack ID */
  packs: z.record(z.string(), RegistryPackEntrySchema),
});

// =============================================================================
// Types (derived from Zod schemas)
// =============================================================================

/** Origin metadata for a pack installed from a local directory */
export type PackOriginLocal = z.infer<typeof PackOriginLocalSchema>;

/** Origin metadata for a pack cloned from git */
export type PackOriginGit = z.infer<typeof PackOriginGitSchema>;

/** Origin metadata for a pack downloaded as a zip */
export type PackOriginZip = z.infer<typeof PackOriginZipSchema>;

/** Origin metadata for a pack installed from npm */
export type PackOriginNpm = z.infer<typeof PackOriginNpmSchema>;

/** Union of all pack origin types */
export type PackOrigin = z.infer<typeof PackOriginSchema>;

/** A single pack install record (for current or history) */
export type PackInstallRecord = z.infer<typeof PackInstallRecordSchema>;

/** A single pack entry in the registry */
export type RegistryPackEntry = z.infer<typeof RegistryPackEntrySchema>;

/** The full registry structure */
export type Registry = z.infer<typeof RegistrySchema>;

// =============================================================================
// Input Types (for API methods)
// =============================================================================

/**
 * Input for registering a new pack.
 * Does not include `installedAt` - that's set automatically.
 */
export interface RegisterPackInput {
  readonly id: string;
  readonly version: string;
  readonly origin: PackOrigin;
  readonly hash: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates an empty registry with the current schema version.
 */
function createEmptyRegistry(): Registry {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packs: {},
  };
}

/**
 * Generates a unique temporary filename in the same directory as the target.
 * Using the same directory ensures atomic rename works (same filesystem).
 */
function getTempFilePath(targetPath: string): string {
  const dir = path.dirname(targetPath);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return path.join(dir, `.registry-${randomSuffix}.tmp`);
}

// =============================================================================
// RegistryService Class
// =============================================================================

/**
 * Service for managing the Scaffoldix pack registry.
 *
 * The registry tracks all installed packs and their metadata. It persists
 * to a JSON file in the Store directory.
 *
 * @example
 * ```typescript
 * import { RegistryService } from "./core/registry/RegistryService.js";
 * import { initStorePaths } from "./core/utils/paths.js";
 *
 * const paths = initStorePaths();
 * const registry = new RegistryService(paths.registryFile);
 *
 * // Load existing registry (or empty if none exists)
 * const data = await registry.load();
 *
 * // Register a new pack
 * await registry.registerPack({
 *   id: "my-pack",
 *   version: "1.0.0",
 *   origin: { type: "local", localPath: "/path/to/pack" },
 *   hash: "abc123...",
 * });
 * ```
 */
export class RegistryService {
  /**
   * Creates a new RegistryService instance.
   *
   * @param registryFilePath - Absolute path to the registry JSON file.
   *   This should come from the Store paths module, never hardcoded.
   */
  constructor(private readonly registryFilePath: string) {
    if (!path.isAbsolute(registryFilePath)) {
      throw new ScaffoldError(
        "Registry file path must be absolute",
        "REGISTRY_INVALID_PATH",
        { path: registryFilePath },
        undefined,
        "The registryFilePath provided to RegistryService must be an absolute path.",
        undefined,
        false // programming error, not operational
      );
    }
  }

  /**
   * Loads the registry from disk.
   *
   * ## Safety Guarantees
   *
   * - If the file does not exist, returns an empty registry (not an error)
   * - If the file exists but contains invalid JSON, throws with details
   * - If the JSON is valid but doesn't match the schema, throws with details
   *
   * @returns The registry object (empty if file doesn't exist)
   * @throws ScaffoldError if file exists but is corrupted or invalid
   */
  async load(): Promise<Registry> {
    let content: string;

    try {
      content = await fs.readFile(this.registryFilePath, "utf-8");
    } catch (error) {
      // File doesn't exist - this is normal for first run
      if (this.isNodeError(error) && error.code === "ENOENT") {
        return createEmptyRegistry();
      }

      // Other read errors (permissions, etc.) should be reported
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        "Failed to read registry file",
        "REGISTRY_READ_ERROR",
        { path: this.registryFilePath, reason: cause.message },
        undefined,
        `Could not read ${this.registryFilePath}. ${cause.message}`,
        cause,
        true
      );
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        "Registry file contains invalid JSON",
        "REGISTRY_INVALID_JSON",
        { path: this.registryFilePath, reason: cause.message },
        undefined,
        `The registry file at ${this.registryFilePath} contains invalid JSON. ` +
          `You may need to delete it and reinstall your packs. Error: ${cause.message}`,
        cause,
        true
      );
    }

    // Validate against schema
    const result = RegistrySchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

      throw new ScaffoldError(
        "Registry file has invalid schema",
        "REGISTRY_INVALID_SCHEMA",
        {
          path: this.registryFilePath,
          issues: result.error.issues,
        },
        undefined,
        `The registry file at ${this.registryFilePath} has an invalid structure. ` +
          `Issues: ${issues}. You may need to delete it and reinstall your packs.`,
        undefined,
        true
      );
    }

    return result.data;
  }

  /**
   * Saves the registry to disk atomically.
   *
   * ## Atomicity Guarantee
   *
   * Uses a write-to-temp-then-rename strategy:
   * 1. Write to a temporary file in the same directory
   * 2. Rename temp file to target (atomic on POSIX, near-atomic on Windows)
   *
   * This ensures a crash mid-save never leaves a corrupted registry.
   *
   * @param registry - The registry object to save
   * @throws ScaffoldError if save fails
   */
  async save(registry: Registry): Promise<void> {
    // Validate before saving (defensive - catch programming errors)
    const result = RegistrySchema.safeParse(registry);
    if (!result.success) {
      throw new ScaffoldError(
        "Cannot save invalid registry",
        "REGISTRY_SAVE_INVALID",
        { issues: result.error.issues },
        undefined,
        "Attempted to save a registry object that doesn't match the schema. This is a bug.",
        undefined,
        false // programming error
      );
    }

    // Serialize with stable formatting (2-space indent for readability)
    const content = JSON.stringify(registry, null, 2) + "\n";

    // Ensure directory exists (defensive - Store should create it, but be safe)
    const dir = path.dirname(this.registryFilePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        "Failed to create registry directory",
        "REGISTRY_DIR_ERROR",
        { path: dir, reason: cause.message },
        undefined,
        `Could not create directory ${dir}. ${cause.message}`,
        cause,
        true
      );
    }

    // Write to temp file first (same directory for atomic rename)
    const tempPath = getTempFilePath(this.registryFilePath);

    try {
      // Write temp file
      await fs.writeFile(tempPath, content, "utf-8");

      // Atomic rename
      // On POSIX: rename is atomic
      // On Windows: rename fails if target exists, so we handle that
      try {
        await fs.rename(tempPath, this.registryFilePath);
      } catch (renameError) {
        // Windows: target exists - try to remove it first, then rename
        if (this.isNodeError(renameError) && renameError.code === "EPERM") {
          try {
            await fs.unlink(this.registryFilePath);
            await fs.rename(tempPath, this.registryFilePath);
          } catch (retryError) {
            // If retry fails, throw the original error
            throw renameError;
          }
        } else {
          throw renameError;
        }
      }
    } catch (error) {
      // Clean up temp file on failure (best effort)
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ScaffoldError(
        "Failed to save registry file",
        "REGISTRY_SAVE_ERROR",
        { path: this.registryFilePath, reason: cause.message },
        undefined,
        `Could not save registry to ${this.registryFilePath}. ${cause.message}`,
        cause,
        true
      );
    }
  }

  /**
   * Registers a pack in the registry.
   *
   * This is a convenience method that:
   * 1. Loads the current registry
   * 2. Upserts the pack entry (insert or update)
   * 3. Saves the registry
   * 4. Returns the updated registry
   *
   * ## Idempotency
   *
   * Calling with the same input multiple times produces the same result.
   * The pack entry is keyed by ID, so re-registering updates the existing entry.
   *
   * @param input - Pack registration details
   * @returns The updated registry
   * @throws ScaffoldError if load or save fails
   */
  async registerPack(input: RegisterPackInput): Promise<Registry> {
    // Validate input
    if (!input.id || typeof input.id !== "string") {
      throw new ScaffoldError(
        "Pack ID is required",
        "REGISTRY_INVALID_INPUT",
        { field: "id", value: input.id },
        undefined,
        "A valid pack ID string is required.",
        undefined,
        true
      );
    }

    if (!input.hash || !/^[a-f0-9]{64}$/.test(input.hash)) {
      throw new ScaffoldError(
        "Valid SHA-256 hash is required",
        "REGISTRY_INVALID_INPUT",
        { field: "hash", value: input.hash },
        undefined,
        "Pack hash must be a valid 64-character SHA-256 hex string.",
        undefined,
        true
      );
    }

    // Load current registry
    const registry = await this.load();

    // Create pack entry with timestamp
    const entry: RegistryPackEntry = {
      id: input.id,
      version: input.version,
      origin: input.origin,
      hash: input.hash,
      installedAt: new Date().toISOString(),
    };

    // Upsert (dictionary keyed by ID ensures no duplicates)
    registry.packs[input.id] = entry;

    // Save updated registry
    await this.save(registry);

    return registry;
  }

  /**
   * Removes a pack from the registry.
   *
   * @param packId - The ID of the pack to remove
   * @returns The updated registry, or null if pack wasn't found
   * @throws ScaffoldError if load or save fails
   */
  async unregisterPack(packId: string): Promise<Registry | null> {
    const registry = await this.load();

    if (!(packId in registry.packs)) {
      return null;
    }

    delete registry.packs[packId];
    await this.save(registry);

    return registry;
  }

  /**
   * Gets a specific pack from the registry.
   *
   * @param packId - The ID of the pack to retrieve
   * @returns The pack entry, or undefined if not found
   */
  async getPack(packId: string): Promise<RegistryPackEntry | undefined> {
    const registry = await this.load();
    return registry.packs[packId];
  }

  /**
   * Lists all registered packs.
   *
   * @returns Array of all pack entries
   */
  async listPacks(): Promise<RegistryPackEntry[]> {
    const registry = await this.load();
    return Object.values(registry.packs);
  }

  /**
   * Updates a pack while preserving the previous version in history.
   *
   * This is used by `pack update` to maintain a history of installations.
   * The previous current entry is moved to history before updating.
   *
   * @param packId - The pack ID to update
   * @param input - New pack data
   * @returns The updated registry
   * @throws ScaffoldError if pack doesn't exist or save fails
   */
  async updatePackWithHistory(
    packId: string,
    input: RegisterPackInput
  ): Promise<Registry> {
    const registry = await this.load();

    const existingEntry = registry.packs[packId];
    if (!existingEntry) {
      throw new ScaffoldError(
        `Pack '${packId}' not found for update`,
        "PACK_NOT_FOUND",
        { packId },
        undefined,
        `Pack '${packId}' is not installed and cannot be updated.`,
        undefined,
        true
      );
    }

    // Create history record from current entry
    const historyRecord: PackInstallRecord = {
      version: existingEntry.version,
      origin: existingEntry.origin,
      hash: existingEntry.hash,
      installedAt: existingEntry.installedAt,
    };

    // Get existing history or create empty array
    const existingHistory = existingEntry.history ?? [];

    // Create new entry with updated data and history
    const updatedEntry: RegistryPackEntry = {
      id: input.id,
      version: input.version,
      origin: input.origin,
      hash: input.hash,
      installedAt: new Date().toISOString(),
      history: [...existingHistory, historyRecord], // Append previous to history
    };

    registry.packs[packId] = updatedEntry;
    await this.save(registry);

    return registry;
  }

  /**
   * Gets the update history for a pack.
   *
   * @param packId - The pack ID to get history for
   * @returns Array of historical install records (oldest first), or null if pack not found
   */
  async getPackHistory(packId: string): Promise<PackInstallRecord[] | null> {
    const registry = await this.load();
    const entry = registry.packs[packId];

    if (!entry) {
      return null;
    }

    return entry.history ?? [];
  }

  /**
   * Registers a pack version, preserving any existing versions.
   *
   * If the pack already exists with a different version, both versions
   * are stored in the `installs` array. If the same hash already exists
   * in installs, the operation is a no-op.
   *
   * @param input - Pack registration details
   * @returns The updated registry
   * @throws ScaffoldError if validation fails
   */
  async registerPackVersion(input: RegisterPackInput): Promise<Registry> {
    const registry = await this.load();
    const existingEntry = registry.packs[input.id];

    if (!existingEntry) {
      // First install - create entry with installs array
      const now = new Date().toISOString();
      const entry: RegistryPackEntry = {
        id: input.id,
        version: input.version,
        origin: input.origin,
        hash: input.hash,
        installedAt: now,
        installs: [
          {
            version: input.version,
            origin: input.origin,
            hash: input.hash,
            installedAt: now,
          },
        ],
      };
      registry.packs[input.id] = entry;
      await this.save(registry);
      return registry;
    }

    // Pack exists - merge into installs
    const existingInstalls: PackInstallRecord[] = existingEntry.installs ?? [
      {
        version: existingEntry.version,
        origin: existingEntry.origin,
        hash: existingEntry.hash,
        installedAt: existingEntry.installedAt,
      },
    ];

    // Check if this exact hash is already in installs (dedup)
    const alreadyInstalled = existingInstalls.some((i) => i.hash === input.hash);
    if (alreadyInstalled) {
      return registry; // No-op
    }

    // Add new version
    const now = new Date().toISOString();
    const newInstall: PackInstallRecord = {
      version: input.version,
      origin: input.origin,
      hash: input.hash,
      installedAt: now,
    };

    const mergedInstalls = [...existingInstalls, newInstall];

    // Update top-level entry to latest version (for backward compat)
    const updatedEntry: RegistryPackEntry = {
      id: input.id,
      version: input.version,
      origin: input.origin,
      hash: input.hash,
      installedAt: now,
      installs: mergedInstalls,
      history: existingEntry.history, // Preserve update history
    };

    registry.packs[input.id] = updatedEntry;
    await this.save(registry);
    return registry;
  }

  /**
   * Registers a pack with multiple installed versions.
   *
   * This is used when installing multiple versions of the same pack
   * so they can be selected via --version flag.
   *
   * @param packId - Pack identifier
   * @param installs - Array of install records (version, origin, hash, installedAt)
   * @returns The updated registry
   * @throws ScaffoldError if validation fails
   */
  async registerPackWithInstalls(
    packId: string,
    installs: PackInstallRecord[]
  ): Promise<Registry> {
    if (!packId || typeof packId !== "string") {
      throw new ScaffoldError(
        "Pack ID is required",
        "REGISTRY_INVALID_INPUT",
        { field: "id", value: packId },
        undefined,
        "A valid pack ID string is required.",
        undefined,
        true
      );
    }

    if (!installs || installs.length === 0) {
      throw new ScaffoldError(
        "At least one install record is required",
        "REGISTRY_INVALID_INPUT",
        { field: "installs", value: installs },
        undefined,
        "At least one install record must be provided.",
        undefined,
        true
      );
    }

    // Load current registry
    const registry = await this.load();

    // Use the first install as the "default" entry (for backward compatibility)
    // Sort by installedAt to find most recent as the "current" version
    const sortedByDate = [...installs].sort(
      (a, b) => new Date(b.installedAt).getTime() - new Date(a.installedAt).getTime()
    );
    const mostRecent = sortedByDate[0];

    // Create pack entry with all installs
    const entry: RegistryPackEntry = {
      id: packId,
      version: mostRecent.version,
      origin: mostRecent.origin,
      hash: mostRecent.hash,
      installedAt: mostRecent.installedAt,
      installs: installs, // Store all versions for selection
    };

    registry.packs[packId] = entry;
    await this.save(registry);

    return registry;
  }

  /**
   * Gets all installed versions for a pack.
   *
   * @param packId - The pack ID to get versions for
   * @returns Array of install records, or null if pack not found
   */
  async getPackInstalls(packId: string): Promise<PackInstallRecord[] | null> {
    const registry = await this.load();
    const entry = registry.packs[packId];

    if (!entry) {
      return null;
    }

    // If installs array exists, return it
    if (entry.installs && entry.installs.length > 0) {
      return entry.installs;
    }

    // Otherwise, construct single install from entry (backward compatibility)
    return [
      {
        version: entry.version,
        origin: entry.origin,
        hash: entry.hash,
        installedAt: entry.installedAt,
      },
    ];
  }

  /**
   * Type guard for Node.js errors with code property.
   */
  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
  }
}
