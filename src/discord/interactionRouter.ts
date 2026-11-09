import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageComponentInteraction,
} from 'discord.js';
import type { CommandContext, SlashCommand } from '../commands/types.ts';

const FAILURE_MESSAGE = 'Something went wrong running that command. Try again in a moment.';

async function reportFailure(interaction: ChatInputCommandInteraction | MessageComponentInteraction): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: FAILURE_MESSAGE, allowedMentions: { parse: [] } });
  } else {
    await interaction.reply({ content: FAILURE_MESSAGE, flags: MessageFlags.Ephemeral });
  }
}

/** Dispatches slash commands and autocomplete to their handlers; never throws. */
export function createInteractionHandler(
  commands: ReadonlyMap<string, SlashCommand>,
  context: CommandContext,
): (interaction: Interaction) => Promise<void> {
  const { logger } = context;
  return async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      try {
        await command?.autocomplete?.(interaction, context);
      } catch (error: unknown) {
        logger.warn('Autocomplete failed', { error, command: interaction.commandName });
      }
      return;
    }
    if (interaction.isMessageComponent()) {
      const name = interaction.customId.split(':')[0] ?? '';
      const command = commands.get(name);
      if (!command?.component) return;
      try {
        await command.component(interaction, context);
      } catch (error: unknown) {
        logger.error('Component interaction failed', { error, customId: interaction.customId });
        await reportFailure(interaction).catch((replyError: unknown) => {
          logger.warn('Could not report the component failure to the user', { error: replyError });
        });
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
      logger.warn('Received an unknown command', { command: interaction.commandName });
      return;
    }
    try {
      await command.execute(interaction, context);
    } catch (error: unknown) {
      logger.error('Command failed', { error, command: interaction.commandName, guildId: interaction.guildId });
      await reportFailure(interaction).catch((replyError: unknown) => {
        logger.warn('Could not report the command failure to the user', { error: replyError });
      });
    }
  };
}
