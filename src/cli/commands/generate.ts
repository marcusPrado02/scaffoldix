import { Command } from "commander";
import { Logger } from "../../core/logger/logger";

export function buildGenerateCommand(logger: Logger): Command {
    const generateCommand = new Command("generate")
        .alias("g")
        .description("Generates code based on templates")
        .argument("<ref>","pack:archetype (ex: java-spring:base-entity)")
        .option("--dry-run", "Executes a simulation without generating files")
        .option("-o, --output <path>", "Output path for generated files", "./output")
        .action(async (ref: string, options: { dryRun?: boolean; output: string }) => {
            logger.info(`Starting code generation with template: ${ref}`, { options });
            logger.info("generate command called (stub)", { ref, options });
            if (options.dryRun) {
                logger.info("Executing in dry-run mode. No files will be generated.");
            }

            logger.info(`Generating files in directory: ${options.output}`);

            logger.info("Code generation completed successfully.");
        });
    
    return generateCommand;

}