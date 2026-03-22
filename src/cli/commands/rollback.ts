/**
 * Rollback command — revert the last generation in the current project.
 *
 * Reads generation history from .scaffoldix/state.json, identifies files
 * that were created in the last successful generation, and removes them.
 * Then removes the last entry from the history.
 *
 * Note: Only files that were *created* (not pre-existing modified files)
 * are eligible for removal. Modified/patched files require manual reversal.
 *
 * Usage:
 *   scaffoldix rollback [--target <dir>] [--yes]
 *
 * @module
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Command } from "commander";
import { getCliUx } from "../ux/CliUx.js";
import { toUserMessage } from "../../core/errors/errors.js";

interface GenerationReport {
  id: string;
  timestamp: string;
  packId: string;
  packVersion: string;
  archetypeId: string;
  inputs: Record<string, unknown>;
  status: "success" | "failure";
  staging?: { used: boolean; committedTo?: string };
  filesWritten?: string[];
}

interface ProjectState {
  schemaVersion: number;
  updatedAt: string;
  generations?: GenerationReport[];
  lastGeneration?: GenerationReport;
}

async function loadState(stateFile: string): Promise<ProjectState | null> {
  try {
    const raw = await fs.readFile(stateFile, "utf-8");
    return JSON.parse(raw) as ProjectState;
  } catch {
    return null;
  }
}

async function saveState(stateFile: string, state: ProjectState): Promise<void> {
  const tmp = stateFile + `.tmp.${process.pid}`;
  await fs.writeFile(
    tmp,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
  await fs.rename(tmp, stateFile);
}

/**
 * Builds the `rollback` command.
 *
 * @returns Configured Commander command
 */
export function buildRollbackCommand(): Command {
  return new Command("rollback")
    .description("Revert the last generation by removing generated files")
    .option("--target <dir>", "Project directory to rollback", ".")
    .option("--yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Show what would be removed without deleting", false)
    .addHelpText(
      "after",
      `
Notes:
  - Only files *created* by the last generation are removed.
  - Files that were patched/modified must be reverted manually.
  - The generation entry is removed from history after rollback.

Examples:
  scaffoldix rollback
  scaffoldix rollback --target ./my-project --yes
  scaffoldix rollback --dry-run`,
    )
    .action(async (options: { target: string; yes: boolean; dryRun: boolean }) => {
      const ux = getCliUx();

      try {
        const targetDir = path.resolve(process.cwd(), options.target);
        const stateFile = path.join(targetDir, ".scaffoldix", "state.json");

        const state = await loadState(stateFile);

        if (!state) {
          ux.info(`No generation history found in ${targetDir}`);
          ux.detail("Nothing to rollback.");
          return;
        }

        // Get generations list
        const generations: GenerationReport[] =
          state.generations ?? (state.lastGeneration ? [state.lastGeneration] : []);

        if (generations.length === 0) {
          ux.info("No generations in history. Nothing to rollback.");
          return;
        }

        // Find the last successful generation
        const lastSuccess = [...generations].reverse().find((g) => g.status === "success");

        if (!lastSuccess) {
          ux.warn("No successful generation found in history. Nothing to rollback.");
          return;
        }

        const date = new Date(lastSuccess.timestamp).toLocaleString();
        ux.info(`Last generation: ${lastSuccess.packId}:${lastSuccess.archetypeId} @ ${date}`);
        ux.info(`Run ID: ${lastSuccess.id}`);

        // Identify files to remove
        const filesWritten: string[] = lastSuccess.filesWritten ?? [];
        if (filesWritten.length === 0) {
          ux.warn("No file list recorded for this generation.");
          ux.detail("The generation predates file tracking. Cannot auto-remove files.");
          ux.detail("You can manually remove the generation entry from .scaffoldix/state.json");
          return;
        }

        const absoluteFiles = filesWritten.map((f) =>
          path.isAbsolute(f) ? f : path.join(targetDir, f),
        );

        // Filter only files that actually exist
        const existingFiles: string[] = [];
        for (const f of absoluteFiles) {
          try {
            await fs.access(f);
            existingFiles.push(f);
          } catch {
            // file already gone
          }
        }

        if (existingFiles.length === 0) {
          ux.info("All generated files have already been removed.");
        } else {
          ux.info(`\nFiles to remove (${existingFiles.length}):`);
          for (const f of existingFiles) {
            const rel = path.relative(targetDir, f);
            ux.detail(`- ${rel}`);
          }
        }

        if (options.dryRun) {
          ux.info("\nDry-run mode: no files were deleted.");
          return;
        }

        // Confirm unless --yes
        if (!options.yes && existingFiles.length > 0) {
          const { confirm } = await import("@clack/prompts");
          const ok = await confirm({
            message: `Remove ${existingFiles.length} file(s) and pop this generation from history?`,
          });
          if (!ok) {
            ux.info("Cancelled.");
            return;
          }
        }

        // Delete files
        let removed = 0;
        for (const f of existingFiles) {
          try {
            await fs.unlink(f);
            removed++;
          } catch (err) {
            ux.warn(`Could not remove ${f}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Remove empty directories left behind
        const dirs = new Set(existingFiles.map((f) => path.dirname(f)));
        for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
          try {
            const entries = await fs.readdir(dir);
            if (entries.length === 0) await fs.rmdir(dir);
          } catch {
            // ignore
          }
        }

        // Update state: remove last successful entry
        const updatedGenerations = state.generations
          ? state.generations.filter((g) => g.id !== lastSuccess.id)
          : [];

        const updatedState: ProjectState = {
          ...state,
          schemaVersion: 2,
          generations: updatedGenerations,
          lastGeneration: updatedGenerations[updatedGenerations.length - 1],
        };

        await saveState(stateFile, updatedState);

        ux.success(`Rollback complete. Removed ${removed} file(s).`);
        ux.detail("Generation entry removed from history.");
      } catch (err) {
        const msg = toUserMessage(err);
        ux.error(msg.message, { code: msg.code });
        process.exitCode = 1;
      }
    });
}
