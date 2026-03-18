/**
 * Pack search command — search for packs in the Scaffoldix public registry.
 *
 * Queries the public pack index (npm registry by default, scoped under
 * the `scaffoldix-pack-` keyword) and lists matching packs.
 *
 * Usage:
 *   scaffoldix pack search <keyword>
 *   scaffoldix pack search java --json
 *
 * @module
 */

import { Command } from "commander";
import { getCliUx } from "../ux/CliUx.js";
import { toUserMessage } from "../../core/errors/errors.js";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search";
const SCAFFOLDIX_KEYWORD = "scaffoldix-pack";

interface NpmSearchPackage {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  links?: { npm?: string; homepage?: string; repository?: string };
  publisher?: { username?: string };
  date?: string;
}

interface NpmSearchResult {
  objects: Array<{ package: NpmSearchPackage; score: { final: number } }>;
  total: number;
}

async function searchNpm(keyword: string, limit: number): Promise<NpmSearchResult> {
  const query = encodeURIComponent(`${keyword} keywords:${SCAFFOLDIX_KEYWORD}`);
  const url = `${NPM_SEARCH_URL}?text=${query}&size=${limit}`;

  const { default: https } = await import("node:https");

  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "scaffoldix-cli" } }, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as NpmSearchResult);
          } catch (e) {
            reject(new Error(`Failed to parse npm search response: ${e}`));
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Builds the `pack search <keyword>` command.
 *
 * @returns Configured Commander command
 */
export function buildPackSearchCommand(): Command {
  return new Command("search")
    .description(`Search for packs in the public Scaffoldix registry (npm keyword: ${SCAFFOLDIX_KEYWORD})`)
    .argument("<keyword>", "Search term")
    .option("--limit <n>", "Maximum number of results", "20")
    .option("--json", "Output as JSON", false)
    .addHelpText(
      "after",
      `
Examples:
  scaffoldix pack search java
  scaffoldix pack search spring --limit 5
  scaffoldix pack search react --json

To publish your own pack so it appears here, add "${SCAFFOLDIX_KEYWORD}" to your
package.json keywords and publish to npm.`,
    )
    .action(async (keyword: string, options: { limit: string; json: boolean }) => {
      const ux = getCliUx();
      const limit = Math.max(1, parseInt(options.limit, 10) || 20);

      try {
        ux.info(`Searching npm registry for "${keyword}"...`);

        const result = await searchNpm(keyword, limit);
        const packs = result.objects.map((o) => o.package);

        if (options.json) {
          process.stdout.write(JSON.stringify(packs, null, 2) + "\n");
          return;
        }

        if (packs.length === 0) {
          ux.info(`No packs found for "${keyword}".`);
          ux.detail(`Publish your pack with keyword "${SCAFFOLDIX_KEYWORD}" to appear here.`);
          return;
        }

        ux.info(`\nFound ${result.total} pack(s) (showing ${packs.length}):\n`);

        for (const pkg of packs) {
          process.stdout.write(`  ${pkg.name}@${pkg.version}\n`);
          if (pkg.description) {
            process.stdout.write(`    ${pkg.description}\n`);
          }
          process.stdout.write(`    Install: scaffoldix pack add npm:${pkg.name}\n\n`);
        }
      } catch (err) {
        const msg = toUserMessage(err);
        ux.error(`Search failed: ${msg.message}`);
        ux.detail("Check your internet connection and try again.");
        process.exitCode = 1;
      }
    });
}
