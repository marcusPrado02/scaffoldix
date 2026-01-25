import  { Command } from 'commander';
import { Logger } from '../../core/logger/logger';

export function buildPackCommand(logger: Logger): Command {
    const packCommand = new Command('pack').description('Gerenciador packs instalados');

    packCommand
        .command("add")
        .argument("<package>", "Local pack path")
        .description("Adds a local pack to the store (MVP: stub) ")
        .action((async(path: string) => {
            logger.info(`Adding local pack from path: ${path}`);
            logger.info("pack.add called (stub)", { path });
        }))

    packCommand
        .command("list")
        .description("Lists installed packs (MVP: stub)")
        .action((async () => {
            logger.info("Listing installed packs...");
            logger.info("pack.list called (stub)");
        }));

    packCommand
        .command("info")
        .argument("<packId>", "Pack ID")
        .description("Shows information about a specific pack (MVP: stub)")
        .action((async (packId: string) => {
            logger.info(`Showing information for pack: ${packId}`);
            logger.info("pack.info called (stub)", { packId });
        }));

    return packCommand;
}