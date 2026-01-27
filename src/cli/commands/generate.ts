/**
 * Generate CLI command.
 *
 * Generates code from an installed pack's archetype templates.
 *
 * Usage:
 *   scaffoldix generate <packId>:<archetypeId> [--target <dir>] [--dry-run]
 *
 * Examples:
 *   scaffoldix generate java-spring:base-entity
 *   scaffoldix generate react-starter:component --target ./src/components
 *   scaffoldix generate my-pack:default --dry-run
 *
 * @module
 */

import * as path from "node:path";
import { Command } from "commander";
import { Logger } from "../../core/logger/logger.js";
import { initStorePaths } from "../../core/utils/paths.js";
import { toUserMessage, ScaffoldError } from "../../core/errors/errors.js";
import {
  handleGenerate,
  formatGenerateOutput,
} from "../handlers/generateHandler.js";

/**
 * Builds the `generate` command.
 *
 * @param logger - Logger instance for output
 * @returns Configured Commander command
 */
export function buildGenerateCommand(_logger: Logger): Command {
  const generateCommand = new Command("generate")
    .alias("g")
    .description("Generate code from an installed pack archetype")
    .argument("<ref>", "Pack and archetype reference (e.g., java-spring:base-entity)")
    .option("--target <dir>", "Target directory for generated files", ".")
    .option("--dry-run", "Preview what would be generated without writing files", false)
    .action(async (ref: string, options: { target: string; dryRun: boolean }) => {
      try {
        // Initialize store paths
        const storePaths = initStorePaths();

        // Resolve target directory to absolute path
        const targetDir = path.resolve(process.cwd(), options.target);

        // Execute handler
        const result = await handleGenerate(
          {
            ref,
            targetDir,
            dryRun: options.dryRun,
            data: {}, // For v0.1, no input collection - just empty data
          },
          {
            registryFile: storePaths.registryFile,
            packsDir: storePaths.packsDir,
            storeDir: storePaths.storeDir,
          }
        );

        // Output formatted result
        const lines = formatGenerateOutput(result);
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

  return generateCommand;
}
