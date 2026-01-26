/**
 * Archetypes management CLI commands.
 *
 * Provides commands for viewing available archetypes:
 * - `archetypes list`: List all archetypes across all installed packs
 *
 * @module
 */

import { Command } from "commander";
import { Logger } from "../../core/logger/logger.js";
import { initStorePaths } from "../../core/utils/paths.js";
import { toUserMessage, ScaffoldError } from "../../core/errors/errors.js";
import {
  handleArchetypesList,
  formatArchetypesListOutput,
} from "../handlers/archetypesListHandler.js";

/**
 * Builds the `archetypes` command with all subcommands.
 *
 * @param logger - Logger instance for output
 * @returns Configured Commander command
 */
export function buildArchetypesCommand(_logger: Logger): Command {
  const archetypesCommand = new Command("archetypes").description(
    "View available archetypes"
  );

  // ─────────────────────────────────────────────────────────────────────────
  // archetypes list
  // ─────────────────────────────────────────────────────────────────────────
  archetypesCommand
    .command("list")
    .description("List all archetypes across all installed packs")
    .action(async () => {
      try {
        // Initialize store paths (creates directories if needed)
        const storePaths = initStorePaths();

        // Execute handler
        const result = await handleArchetypesList({
          registryFile: storePaths.registryFile,
          packsDir: storePaths.packsDir,
        });

        // Format output
        const { stdout, stderr } = formatArchetypesListOutput(result);

        // Write warnings to stderr
        for (const line of stderr) {
          process.stderr.write(line + "\n");
        }

        // Write list to stdout
        for (const line of stdout) {
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

  return archetypesCommand;
}
