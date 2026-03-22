/**
 * History command — display generation history for the current project.
 *
 * Reads the .scaffoldix/state.json file from the current (or specified)
 * target directory and prints a human-readable log of all past generations.
 *
 * Usage:
 *   scaffoldix history [--target <dir>] [--limit <n>] [--json]
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
  patches?: { total: number; applied: number; failed: number };
  hooks?: { items: Array<{ command: string; status: string }> };
  checks?: { items: Array<{ command: string; status: string }> };
  error?: { stage: string; message: string };
}

interface ProjectState {
  schemaVersion: number;
  updatedAt: string;
  generations?: GenerationReport[];
  lastGeneration?: GenerationReport;
}

async function loadState(targetDir: string): Promise<ProjectState | null> {
  const statePath = path.join(targetDir, ".scaffoldix", "state.json");
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw) as ProjectState;
  } catch {
    return null;
  }
}

function formatReport(report: GenerationReport, index: number): string[] {
  const lines: string[] = [];
  const date = new Date(report.timestamp).toLocaleString();
  const statusMark = report.status === "success" ? "✓" : "✗";

  lines.push(`${index}. ${statusMark} ${report.packId}:${report.archetypeId} @ ${date}`);
  lines.push(`   Pack version : ${report.packVersion}`);
  lines.push(`   Run ID       : ${report.id}`);

  const inputKeys = Object.keys(report.inputs);
  if (inputKeys.length > 0) {
    const inputSummary = inputKeys
      .map((k) => `${k}=${JSON.stringify(report.inputs[k])}`)
      .join(", ");
    lines.push(`   Inputs       : ${inputSummary}`);
  }

  if (report.patches) {
    lines.push(
      `   Patches      : ${report.patches.applied}/${report.patches.total} applied, ${report.patches.failed} failed`,
    );
  }

  if (report.status === "failure" && report.error) {
    lines.push(`   Error        : [${report.error.stage}] ${report.error.message}`);
  }

  return lines;
}

/**
 * Builds the `history` command.
 *
 * @returns Configured Commander command
 */
export function buildHistoryCommand(): Command {
  return new Command("history")
    .description("Display generation history for the current project")
    .option("--target <dir>", "Project directory to inspect", ".")
    .option("--limit <n>", "Number of entries to show (most recent first)", "20")
    .option("--json", "Output raw history as JSON", false)
    .addHelpText(
      "after",
      `
Examples:
  scaffoldix history
  scaffoldix history --target ./my-project --limit 5
  scaffoldix history --json`,
    )
    .action(async (options: { target: string; limit: string; json: boolean }) => {
      const ux = getCliUx();

      try {
        const targetDir = path.resolve(process.cwd(), options.target);
        const limit = Math.max(1, parseInt(options.limit, 10) || 20);

        const state = await loadState(targetDir);

        if (!state) {
          ux.info(`No generation history found in ${targetDir}`);
          ux.detail("Run `scaffoldix generate` to create your first generation.");
          return;
        }

        // Normalize to array (support both v1 and v2)
        let generations: GenerationReport[] = [];
        if (state.generations && state.generations.length > 0) {
          generations = state.generations;
        } else if (state.lastGeneration) {
          generations = [state.lastGeneration];
        }

        if (generations.length === 0) {
          ux.info(`No generation history found in ${targetDir}`);
          return;
        }

        // Most recent first
        const sorted = [...generations].reverse().slice(0, limit);

        if (options.json) {
          process.stdout.write(JSON.stringify(sorted, null, 2) + "\n");
          return;
        }

        ux.info(`Generation history for ${targetDir}`);
        ux.info(`Showing ${sorted.length} of ${generations.length} entries\n`);

        for (let i = 0; i < sorted.length; i++) {
          const lines = formatReport(sorted[i], i + 1);
          for (const line of lines) {
            process.stdout.write(line + "\n");
          }
          process.stdout.write("\n");
        }
      } catch (err) {
        const msg = toUserMessage(err);
        ux.error(msg.message, { code: msg.code });
        process.exitCode = 1;
      }
    });
}
