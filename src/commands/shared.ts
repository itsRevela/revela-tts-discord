import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { GuildSpeaker } from '../playback/guildSpeakers.ts';

export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** Members in the bot's channel can control it, as can anyone allowed to move members. */
export function canControl(member: GuildMember, speaker: GuildSpeaker): boolean {
  return member.voice.channelId === speaker.channelId || member.permissions.has(PermissionFlagsBits.MoveMembers);
}
