/**
 * Doctor CLI command for Scaffoldix environment diagnostics.
 *
 * Provides a comprehensive health check of the Scaffoldix environment:
 * - Node.js version compatibility
 * - pnpm availability
 * - Store write permissions
 * - Registry integrity
 *
 * @module
 */

import { Command } from "commander";
import { initStorePaths } from "../../core/utils/paths.js";
import {
  handleDoctor,
  createDefaultDoctorDependencies,
  formatDoctorReport,
} from "../handlers/doctorHandler.js";

/**
 * Builds the `doctor` command.
 *
 * @returns Configured Commander command
 */
export function buildDoctorCommand(): Command {
  const doctorCommand = new Command("doctor")
    .description("Check Scaffoldix environment and diagnose issues")
    .action(async () => {
      try {
        // Initialize store paths (creates directories if needed)
        const storePaths = initStorePaths();

        // Create dependencies with real system checks
        const deps = createDefaultDoctorDependencies(storePaths);

        // Run diagnostics
        const result = await handleDoctor(deps);

        // Format and output report
        const lines = formatDoctorReport(result);
        for (const line of lines) {
          process.stdout.write(line + "\n");
        }

        // Set exit code based on result
        if (result.hasErrors) {
          process.exitCode = 1;
        }
      } catch (err) {
        // Doctor should never crash, but handle unexpected errors gracefully
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error running diagnostics: ${message}\n`);
        process.exitCode = 1;
      }
    });

  return doctorCommand;
}
