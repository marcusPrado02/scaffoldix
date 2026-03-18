/**
 * Verify command — verify the integrity of an installed pack.
 *
 * Checks that no files in an installed pack have been modified, deleted,
 * or added since installation by comparing SHA-256 file hashes against
 * the stored integrity manifest.
 *
 * Usage:
 *   scaffoldix pack verify <packId>
 *
 * @module
 */

import * as path from "node:path";
import { Command } from "commander";
import { getCliUx } from "../ux/CliUx.js";
import { initStorePaths } from "../../core/utils/paths.js";
import { RegistryService } from "../../core/registry/RegistryService.js";
import { verifyPackIntegrity } from "../../core/store/PackIntegrity.js";
import { ScaffoldError, toUserMessage } from "../../core/errors/errors.js";

/**
 * Builds the `pack verify <packId>` command.
 *
 * @returns Configured Commander command
 */
export function buildPackVerifyCommand(): Command {
  return new Command("verify")
    .description("Verify the integrity of an installed pack using SHA-256 file hashes")
    .argument("<packId>", "Pack ID to verify")
    .option("--json", "Output result as JSON", false)
    .addHelpText(
      "after",
      `
Examples:
  scaffoldix pack verify my-pack
  scaffoldix pack verify @myorg/java-spring --json`,
    )
    .action(async (packId: string, options: { json: boolean }) => {
      const ux = getCliUx();

      try {
        const storePaths = initStorePaths();
        const registry = new RegistryService(storePaths.registryFile);
        const entry = await registry.getPack(packId);

        if (!entry) {
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

        // Compute store path
        const sanitizedId = packId.replace(/\//g, "__").replace(/[<>:"|?*]/g, "_");
        const packDir = path.join(storePaths.packsDir, sanitizedId, entry.hash);

        ux.info(`Verifying pack "${packId}@${entry.version}"...`);

        const result = await verifyPackIntegrity(packDir);

        if (options.json) {
          process.stdout.write(
            JSON.stringify({ packId, version: entry.version, ...result }, null, 2) + "\n",
          );
          return;
        }

        if (result.valid) {
          ux.success(`Pack "${packId}" integrity check passed — all files are intact.`);
          if (result.extra.length > 0) {
            ux.warn(`${result.extra.length} extra file(s) found (not tracked in integrity manifest):`);
            for (const f of result.extra) ux.detail(`  + ${f}`);
          }
          return;
        }

        ux.error(`Pack "${packId}" integrity check FAILED`);

        if (result.missing.length > 0) {
          process.stdout.write(`\n  Missing files (${result.missing.length}):\n`);
          for (const f of result.missing) process.stdout.write(`    ✗ ${f}\n`);
        }

        if (result.modified.length > 0) {
          process.stdout.write(`\n  Modified files (${result.modified.length}):\n`);
          for (const f of result.modified) process.stdout.write(`    ~ ${f}\n`);
        }

        ux.detail("Re-install the pack to restore integrity: scaffoldix pack add <source>");
        process.exitCode = 1;
      } catch (err) {
        const msg = toUserMessage(err);
        ux.error(msg.message, {
          code: msg.code,
          hint: err instanceof ScaffoldError ? err.hint : undefined,
        });
        process.exitCode = 1;
      }
    });
}
