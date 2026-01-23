import { Command } from "commander";
import { Logger } from "../../core/logger/logger";

export function buildGenerateCommand(logger: Logger): Command {
    const generateCommand = new Command("generate")
        .alias("g")
        .description("Gera código baseado em templates")
        .argument("<ref>","pack:archetype (ex: java-spring:base-entity)")
        .option("--dry-run", "Executa uma simulação sem gerar arquivos")
        .option("-o, --output <path>", "Caminho de saída para os arquivos gerados", "./output")
        .action(async (ref: string, options: { dryRun?: boolean; output: string }) => {
            logger.info(`Iniciando geração de código com o template: ${ref}`, { options });
            logger.info("generate command chamado (stub)", { ref, options });

            if (options.dryRun) {
                logger.info("Executando em modo dry-run. Nenhum arquivo será gerado.");
            }

            logger.info(`Gerando arquivos no diretório: ${options.output}`);

            logger.info("Geração de código concluída com sucesso.");
        });
    
    return generateCommand;

}