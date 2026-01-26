/**
 * Pack management CLI commands.
 *
 * Provides commands for managing Scaffoldix packs:
 * - `pack add <path>`: Install a local pack into the Store
 * - `pack list`: List installed packs
 * - `pack info <packId>`: Show pack details
 *
 * @module
 */

import { Command } from "commander";
import { Logger } from "../../core/logger/logger.js";
import { initStorePaths } from "../../core/utils/paths.js";
import { toUserMessage, ScaffoldError } from "../../core/errors/errors.js";
import {
  handlePackAdd,
  formatPackAddSuccess,
  type PackAddDependencies,
} from "../handlers/packAddHandler.js";

/**
 * Adapter to make Logger compatible with StoreLogger interface.
 * The Logger class already has the required methods, but TypeScript
 * needs explicit type matching for the interface.
 */
function createStoreLogger(logger: Logger) {
  return {
    info: (
      message: string,
      context?: Record<string, unknown>,
      data?: Record<string, unknown>
    ) => logger.info(message, context, data),
    debug: (
      message: string,
      context?: Record<string, unknown>,
      data?: Record<string, unknown>
    ) => logger.debug(message, context, data),
    warn: (
      message: string,
      context?: Record<string, unknown>,
      data?: Record<string, unknown>
    ) => logger.warn(message, context, data),
  };
}

/**
 * Builds the `pack` command with all subcommands.
 *
 * @param logger - Logger instance for output
 * @returns Configured Commander command
 */
export function buildPackCommand(logger: Logger): Command {
  const packCommand = new Command("pack").description("Manage installed packs");

  // ─────────────────────────────────────────────────────────────────────────
  // pack add <path>
  // ─────────────────────────────────────────────────────────────────────────
  packCommand
    .command("add")
    .argument("<path>", "Path to the local pack directory")
    .description("Install a local pack into the Store")
    .action(async (packPath: string) => {
      try {
        // Initialize store paths (creates directories if needed)
        const storePaths = initStorePaths();

        // Build dependencies for handler
        const deps: PackAddDependencies = {
          storeConfig: {
            storeDir: storePaths.storeDir,
            packsDir: storePaths.packsDir,
            registryFile: storePaths.registryFile,
          },
          logger: createStoreLogger(logger),
        };

        // Execute handler
        const result = await handlePackAdd(
          {
            packPath,
            cwd: process.cwd(),
          },
          deps
        );

        // Output success message
        const lines = formatPackAddSuccess(result);
        for (const line of lines) {
          process.stdout.write(line + "\n");
        }
      } catch (err) {
        // Format error for user
        const userMessage = toUserMessage(err);
        const prefix = userMessage.code ? `${userMessage.code}: ` : "";

        // Include hint if available
        let output = `Error: ${prefix}${userMessage.message}`;
        if (err instanceof ScaffoldError && err.hint) {
          output += `\n\nHint: ${err.hint}`;
        }

        process.stderr.write(output + "\n");
        process.exitCode = 1;
      }
    });

  // ─────────────────────────────────────────────────────────────────────────
  // pack list
  // ─────────────────────────────────────────────────────────────────────────
  packCommand
    .command("list")
    .description("List installed packs")
    .action(async () => {
      logger.info("Listing installed packs...");
      logger.info("pack.list called (stub)");
    });

  // ─────────────────────────────────────────────────────────────────────────
  // pack info <packId>
  // ─────────────────────────────────────────────────────────────────────────
  packCommand
    .command("info")
    .argument("<packId>", "Pack ID to show information for")
    .description("Show information about a specific pack")
    .action(async (packId: string) => {
      logger.info(`Showing information for pack: ${packId}`);
      logger.info("pack.info called (stub)", { packId });
    });

  return packCommand;
}
