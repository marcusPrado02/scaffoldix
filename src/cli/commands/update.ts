/**
 * Update command — update an installed pack to a newer version.
 *
 * Re-installs a pack from its original source (local path or git URL),
 * replacing the existing version in the Store and Registry.
 *
 * Usage:
 *   scaffoldix pack update <packId>
 *   scaffoldix pack update <packId> --path ./new-version
 *   scaffoldix pack update <packId> --ref main
 *
 * @module
 */

import { Command } from "commander";
import { initStorePaths } from "../../core/utils/paths.js";
import { RegistryService } from "../../core/registry/RegistryService.js";
import { ScaffoldError, toUserMessage } from "../../core/errors/errors.js";
import { handlePackAdd, type PackAddDependencies } from "../handlers/packAddHandler.js";
import { handlePackRemove, type PackRemoveDependencies } from "../handlers/packRemoveHandler.js";
import { getCliUx } from "../ux/CliUx.js";
import { Logger } from "../../core/logger/logger.js";

function createStoreLogger(logger: Logger) {
  return {
    info: (msg: string, ctx?: Record<string, unknown>, data?: Record<string, unknown>) =>
      logger.info(msg, ctx, data),
    debug: (msg: string, ctx?: Record<string, unknown>, data?: Record<string, unknown>) =>
      logger.debug(msg, ctx, data),
    warn: (msg: string, ctx?: Record<string, unknown>, data?: Record<string, unknown>) =>
      logger.warn(msg, ctx, data),
  };
}

/**
 * Builds the `pack update <packId>` command.
 *
 * @returns Configured Commander command
 */
export function buildPackUpdateCommand(): Command {
  const logger = new Logger("info");

  return new Command("update")
    .description("Update an installed pack to a newer version from its source")
    .argument("<packId>", "Pack ID to update")
    .option("--path <path>", "Override source path (for local packs)")
    .option("--ref <ref>", "Git ref to checkout (branch, tag, or commit) for git-origin packs")
    .option("--yes", "Skip confirmation prompt", false)
    .addHelpText(
      "after",
      `
Examples:
  scaffoldix pack update my-pack
  scaffoldix pack update my-pack --ref v1.2.0
  scaffoldix pack update my-pack --path ./my-pack-v2`,
    )
    .action(
      async (packId: string, options: { path?: string; ref?: string; yes: boolean }) => {
        const ux = getCliUx();

        try {
          const storePaths = initStorePaths();
          const storeLogger = createStoreLogger(logger);

          // Load registry to get current pack info
          const registry = new RegistryService(storePaths.registryFile);
          const packEntry = await registry.getPack(packId);

          if (!packEntry) {
            throw new ScaffoldError(
              `Pack '${packId}' is not installed`,
              "PACK_NOT_FOUND",
              { packId },
              undefined,
              `Run \`scaffoldix pack list\` to see installed packs.`,
              undefined,
              true,
            );
          }

          // Determine source: override path > original origin
          let sourcePath: string;
          let isGitUrl = false;

          if (options.path) {
            sourcePath = options.path;
          } else if (packEntry.origin.type === "git") {
            sourcePath = packEntry.origin.gitUrl;
            isGitUrl = true;
          } else if (packEntry.origin.type === "local") {
            sourcePath = packEntry.origin.path;
          } else {
            throw new ScaffoldError(
              `Cannot update pack '${packId}': unsupported origin type '${packEntry.origin.type}'`,
              "PACK_UPDATE_UNSUPPORTED_ORIGIN",
              { packId, originType: packEntry.origin.type },
              undefined,
              `Provide --path to specify the new source location.`,
              undefined,
              true,
            );
          }

          // Confirm update unless --yes
          if (!options.yes) {
            const { confirm } = await import("@clack/prompts");
            const ok = await confirm({
              message: `Update pack "${packId}@${packEntry.version}" from ${sourcePath}?`,
            });
            if (!ok) {
              ux.info("Cancelled.");
              return;
            }
          }

          ux.info(`Updating pack ${packId}@${packEntry.version}...`);

          const storeConfig = {
            storeDir: storePaths.storeDir,
            packsDir: storePaths.packsDir,
            registryFile: storePaths.registryFile,
          };

          // Remove old version
          const removeDeps: PackRemoveDependencies = {
            registryFile: storePaths.registryFile,
            packsDir: storePaths.packsDir,
            logger: storeLogger,
          };
          await handlePackRemove({ packId }, removeDeps);

          // Install new version
          const addDeps: PackAddDependencies = {
            storeConfig,
            logger: storeLogger,
          };
          const result = await handlePackAdd(
            { packPath: sourcePath, cwd: process.cwd(), isGitUrl, ref: options.ref },
            addDeps,
          );

          ux.success(`Updated pack ${result.packId} to v${result.version}`);
          ux.detail(`From: ${result.sourcePath}`);
          ux.detail(`Hash: ${result.hash}`);
        } catch (err) {
          const msg = toUserMessage(err);
          ux.error(msg.message, {
            code: msg.code,
            hint: err instanceof ScaffoldError ? err.hint : undefined,
          });
          process.exitCode = 1;
        }
      },
    );
}
