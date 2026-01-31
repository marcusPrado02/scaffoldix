import { Command } from "commander";
import { Logger } from "../core/logger/logger.js";
import { toUserMessage, ScaffoldError } from "../core/errors/errors.js";
import { buildPackCommand } from "./commands/pack.js";
import { buildGenerateCommand } from "./commands/generate.js";
import { buildArchetypesCommand } from "./commands/archetypes.js";
import { buildDoctorCommand } from "./commands/doctor.js";
import { createCliUx, setDefaultCliUx, parseLogLevel, getCliUx } from "./ux/CliUx.js";

async function main() {
  const program = new Command()
    .name("scaffoldix")
    .description("Scaffoldix - Professional scaffolding CLI via deterministic packs")
    .version("0.1.0")
    .option("--verbose", "Show additional context and details", false)
    .option("--debug", "Show all output including debug traces", false)
    .option("--silent", "Suppress all output except errors", false);

  // Hook to set up CliUx before any command runs
  program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    const level = parseLogLevel({
      verbose: opts.verbose ?? false,
      debug: opts.debug ?? false,
      silent: opts.silent ?? false,
    });

    const ux = createCliUx({ level });
    setDefaultCliUx(ux);
  });

  // Compatibility: create logger from CliUx level (for commands still using Logger)
  const logger = new Logger(process.env.SCAFFOLDIX_LOG_LEVEL === "debug" ? "debug" : "info");

  program.addCommand(buildPackCommand(logger));
  program.addCommand(buildGenerateCommand(logger));
  program.addCommand(buildArchetypesCommand(logger));
  program.addCommand(buildDoctorCommand());

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const ux = getCliUx();
    const u = toUserMessage(err);

    // Show error with context
    ux.error(u.message, {
      code: u.code,
      hint: err instanceof ScaffoldError ? err.hint : undefined,
    });

    // In debug mode, show stack trace
    if (err instanceof Error && program.opts().debug) {
      ux.debug(err.stack ?? "No stack trace available");
    }

    process.exitCode = 1;
  }
}

main();
