import type { Client } from 'discord.js';
import type { SlashCommand } from '../commands/types.ts';
import type { Logger } from '../logging/logger.ts';

/**
 * Registers slash commands. A guild id registers to that server only, which
 * updates instantly; otherwise commands are global and can take a while to appear.
 */
export async function registerCommands(
  client: Client<true>,
  commands: ReadonlyMap<string, SlashCommand>,
  guildId: string | undefined,
  logger: Logger,
): Promise<void> {
  const body = [...commands.values()].map((command) => command.data);
  if (guildId) {
    await client.application.commands.set(body, guildId);
    logger.info('Registered slash commands for one server', { guildId, count: body.length });
  } else {
    await client.application.commands.set(body);
    logger.info('Registered global slash commands', { count: body.length });
  }
}
