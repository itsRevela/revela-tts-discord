import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { canControl, replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, 'Use /skip in a server.');
    return;
  }
  const speaker = context.speakers.get(interaction.guildId);
  if (!speaker) {
    await replyEphemeral(interaction, 'I\'m not in a voice channel right now.');
    return;
  }
  if (!canControl(interaction.member, speaker)) {
    await replyEphemeral(interaction, `Join <#${speaker.channelId}> to skip messages.`);
    return;
  }
  await replyEphemeral(interaction, speaker.skip() ? 'Skipped.' : 'Nothing is playing.');
}

export const skipCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Stop the message being read aloud')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  execute,
};
