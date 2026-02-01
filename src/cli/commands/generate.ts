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
  formatTraceOutput,
} from "../handlers/generateHandler.js";
import { getCliUx, createCliUx, setDefaultCliUx } from "../ux/CliUx.js";
import { createCliSpinner } from "../ux/CliSpinner.js";

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
    .option("--yes", "Non-interactive mode: use defaults without prompting", false)
    .option("--force", "Overwrite existing files without prompting", false)
    .option("--verbose", "Show detailed timing trace for each phase", false)
    .action(
      async (
        ref: string,
        options: {
          target: string;
          dryRun: boolean;
          yes: boolean;
          force: boolean;
          verbose: boolean;
        },
      ) => {
        // Set up UX with verbose level if requested
        if (options.verbose) {
          setDefaultCliUx(createCliUx({ level: "verbose" }));
        }
        const ux = getCliUx();
        const spinner = createCliSpinner({ ux });

        try {
          // Initialize store paths
          const storePaths = initStorePaths();

          // Resolve target directory to absolute path
          const targetDir = path.resolve(process.cwd(), options.target);

          // Show what we're doing
          if (options.dryRun) {
            ux.info(`Dry run: ${ref}`);
          } else {
            spinner.start(`Generating from ${ref}`);
          }

          // Execute handler
          const result = await handleGenerate(
            {
              ref,
              targetDir,
              dryRun: options.dryRun,
              data: {}, // Provided values (from future --set flags)
              nonInteractive: options.yes,
              force: options.force,
            },
            {
              registryFile: storePaths.registryFile,
              packsDir: storePaths.packsDir,
              storeDir: storePaths.storeDir,
            },
          );

          // Stop spinner before output
          if (!options.dryRun) {
            spinner.stop();
          }

          // Output formatted result using CliUx
          const lines = formatGenerateOutput(result);
          for (const line of lines) {
            // Parse line to determine type
            if (line.startsWith("✓") || line.startsWith("Generated")) {
              ux.success(line.replace(/^✓\s*/, ""));
            } else if (line.startsWith("  ")) {
              ux.detail(line.trim());
            } else if (line.trim()) {
              ux.info(line);
            }
          }

          // Display trace output (summary by default, details in verbose)
          if (result.trace && result.trace.trace.length > 0) {
            ux.info("");
            ux.info("Trace:");
            const traceLines = formatTraceOutput(result.trace);
            for (const traceLine of traceLines) {
              ux.info(traceLine);
            }
          }
        } catch (err) {
          // Stop spinner on error
          spinner.stop();

          // Format error for user using CliUx
          const userMessage = toUserMessage(err);

          ux.error(userMessage.message, {
            code: userMessage.code,
            hint: err instanceof ScaffoldError ? err.hint : undefined,
          });

          process.exitCode = 1;
        }
      },
    );

  return generateCommand;
}
