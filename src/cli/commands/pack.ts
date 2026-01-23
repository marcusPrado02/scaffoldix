import  { Command } from 'commander';
import { Logger } from '../../core/logger/logger';

export function buildPackCommand(logger: Logger): Command {
    const packCommand = new Command('pack').description('Gerenciador packs instalados');

    packCommand
        .command("add")
        .argument("<package>", "Caminho do pack local")
        .description("Adiciona um pack local ao store (MVP: stub) ")
        .action((async(path: string) => {
            logger.info(`Adicionando pack local do caminho: ${path}`);
            logger.info("pack.add chamado (stub)", { path });
        }))

    packCommand
        .command("list")
        .description("Lista os packs instalados (MVP: stub)")
        .action((async () => {
            logger.info("Listando packs instalados...");
            logger.info("pack.list chamado (stub)");
        }));

    packCommand
        .command("info")
        .argument("<packId>", "ID do pack")
        .description("Mostra informações sobre um pack específico (MVP: stub)")
        .action((async (packId: string) => {
            logger.info(`Mostrando informações do pack: ${packId}`);
            logger.info("pack.info chamado (stub)", { packId });
        }));

    return packCommand;
}