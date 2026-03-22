/**
 * Publish command — publish a pack to npm.
 *
 * Validates the pack, then runs `npm publish` in the pack directory.
 * Automatically adds the "scaffoldix-pack" keyword so the pack appears
 * in `scaffoldix pack search` results.
 *
 * Usage:
 *   scaffoldix pack publish [path] [--tag <tag>] [--dry-run] [--access public|restricted]
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Command } from "commander";
import { execa } from "execa";
import { getCliUx } from "../ux/CliUx.js";
import { ManifestLoader } from "../../core/manifest/ManifestLoader.js";
import { toUserMessage } from "../../core/errors/errors.js";

const SCAFFOLDIX_KEYWORD = "scaffoldix-pack";

/**
 * Ensures package.json in packDir has the scaffoldix-pack keyword.
 * Returns true if the file was modified.
 */
async function ensureKeyword(packDir: string): Promise<boolean> {
  const pkgPath = path.join(packDir, "package.json");
  let pkg: Record<string, unknown>;

  try {
    const raw = await fs.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false; // No package.json — npm publish will fail anyway
  }

  const keywords: string[] = Array.isArray(pkg.keywords) ? (pkg.keywords as string[]) : [];
  if (keywords.includes(SCAFFOLDIX_KEYWORD)) return false;

  keywords.push(SCAFFOLDIX_KEYWORD);
  pkg.keywords = keywords;

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  return true;
}

/**
 * Builds the `pack publish [path]` command.
 *
 * @returns Configured Commander command
 */
export function buildPackPublishCommand(): Command {
  return new Command("publish")
    .description("Publish a pack to npm so it appears in scaffoldix pack search")
    .argument("[path]", "Path to the pack directory (default: current directory)", ".")
    .option("--tag <tag>", "npm dist-tag for this publish (default: latest)")
    .option(
      "--access <access>",
      "npm access level: public | restricted (default: public)",
      "public",
    )
    .option(
      "--dry-run",
      "Run validation and show what would be published without actually publishing",
      false,
    )
    .option("--skip-validation", "Skip pack validation before publishing", false)
    .addHelpText(
      "after",
      `
Prerequisites:
  - You must be logged in to npm: npm login
  - Your pack must have a valid package.json with a "name" and "version"
  - Your pack must have a valid archetype.yaml / pack.yaml

The "${SCAFFOLDIX_KEYWORD}" keyword will be added automatically so users can
discover your pack with: scaffoldix pack search <keyword>

Examples:
  scaffoldix pack publish
  scaffoldix pack publish ./my-pack --tag beta
  scaffoldix pack publish --dry-run
  scaffoldix pack publish --access restricted`,
    )
    .action(
      async (
        packPath: string,
        options: { tag?: string; access: string; dryRun: boolean; skipValidation: boolean },
      ) => {
        const ux = getCliUx();

        try {
          const resolvedPath = path.resolve(process.cwd(), packPath);

          // 1. Validate the pack manifest
          if (!options.skipValidation) {
            ux.info("Validating pack...");
            const loader = new ManifestLoader();
            const manifest = await loader.loadFromDir(resolvedPath);
            ux.success(`Pack "${manifest.pack.name}@${manifest.pack.version}" validated`);
          }

          // 2. Check package.json exists
          const pkgPath = path.join(resolvedPath, "package.json");
          try {
            await fs.access(pkgPath);
          } catch {
            ux.error("No package.json found in pack directory.");
            ux.detail("Create a package.json with at minimum: name, version.");
            process.exitCode = 1;
            return;
          }

          // 3. Ensure scaffoldix-pack keyword is present
          const keywordAdded = await ensureKeyword(resolvedPath);
          if (keywordAdded) {
            ux.info(`Added "${SCAFFOLDIX_KEYWORD}" keyword to package.json`);
          }

          // 4. Build npm publish args
          const npmArgs = ["publish"];
          if (options.tag) npmArgs.push("--tag", options.tag);
          npmArgs.push("--access", options.access);
          if (options.dryRun) npmArgs.push("--dry-run");

          ux.info(`\nRunning: npm ${npmArgs.join(" ")}`);
          if (options.dryRun) {
            ux.info("(dry-run mode — nothing will be published)");
          }

          // 5. Run npm publish
          const result = await execa("npm", npmArgs, {
            cwd: resolvedPath,
            timeout: 120_000,
            stdio: "inherit",
          });

          if (!options.dryRun) {
            ux.success("Pack published successfully!");
            ux.detail("Users can now install it with: scaffoldix pack add npm:<your-package-name>");
          } else {
            ux.success("Dry-run complete — pack is ready to publish.");
          }
        } catch (err) {
          const msg = toUserMessage(err);
          ux.error(`Publish failed: ${msg.message}`);
          ux.detail("Make sure you are logged in to npm (npm login) and have publish permissions.");
          process.exitCode = 1;
        }
      },
    );
}
