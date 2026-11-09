import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { canControl, replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, 'Use /leave in a server.');
    return;
  }
  const speaker = context.speakers.get(interaction.guildId);
  if (!speaker) {
    await replyEphemeral(interaction, 'I\'m not in a voice channel right now.');
    return;
  }
  if (!canControl(interaction.member, speaker)) {
    await replyEphemeral(interaction, `Join <#${speaker.channelId}> to make me leave.`);
    return;
  }
  const channelId = speaker.channelId;
  context.speakers.disconnect(interaction.guildId);
  await replyEphemeral(interaction, `Left <#${channelId}>.`);
}

export const leaveCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Make the bot leave the voice channel and drop queued messages')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  execute,
};
