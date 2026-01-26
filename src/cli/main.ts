import { Command } from "commander";
import { Logger } from "../core/logger/logger.js";
import { toUserMessage } from "../core/errors/errors.js";
import { buildPackCommand } from "./commands/pack.js";
import { buildGenerateCommand } from "./commands/generate.js";
import { buildArchetypesCommand } from "./commands/archetypes.js";

async function main() {
  const logger = new Logger(process.env.SCAFFOLDIX_LOG_LEVEL === "debug" ? "debug" : "info");

  const program = new Command()
    .name("scaffoldix")
    .description("Scaffoldix - Professional scaffolding CLI via deterministic packs")
    .version("0.1.0");

  program.addCommand(buildPackCommand(logger));
  program.addCommand(buildGenerateCommand(logger));
  program.addCommand(buildArchetypesCommand(logger));

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const u = toUserMessage(err);
    process.stderr.write(`[scaffoldix] ${u.code ? `${u.code}: ` : ""}${u.message}\n`);
    process.exitCode = 1;
  }
}

main();
