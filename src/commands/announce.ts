import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

export const ANNOUNCE_ON = 'I\'ll say your name before your messages whenever someone else spoke last.';
export const ANNOUNCE_OFF = 'I won\'t say your name before your messages.';

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  const current = context.preferences.get(userId).announceName;
  const enabled = interaction.options.getBoolean('enabled') ?? !current;
  await context.preferences.update(userId, { announceName: enabled });
  await replyEphemeral(interaction, enabled ? ANNOUNCE_ON : ANNOUNCE_OFF);
}

export const announceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Turn "<your name> says" before your /tts messages on or off')
    .setContexts(InteractionContextType.Guild)
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('On or off; leave empty to toggle'),
    )
    .toJSON(),
  execute,
};
