import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import type { GuildSpeaker } from '../playback/guildSpeakers.ts';

export async function replyEphemeral(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** Explains why the bot cannot speak in a channel, or returns undefined if it can. */
export function voiceChannelProblem(channel: VoiceBasedChannel, me: GuildMember | null): string | undefined {
  if (channel.type === ChannelType.GuildStageVoice) return 'Stage channels are not supported. Use a regular voice channel.';
  const permissions = me ? channel.permissionsFor(me) : null;
  const missing = [
    [PermissionFlagsBits.ViewChannel, 'View Channel'],
    [PermissionFlagsBits.Connect, 'Connect'],
    [PermissionFlagsBits.Speak, 'Speak'],
  ] as const;
  const absent = missing.filter(([flag]) => !permissions?.has(flag)).map(([, label]) => label);
  if (absent.length > 0) return `I need the ${absent.join(', ')} permission in <#${channel.id}>.`;
  if (!channel.joinable) return `<#${channel.id}> is full, so I can't join it.`;
  return undefined;
}

/** Members in the bot's channel can control it, as can anyone allowed to move members. */
export function canControl(member: GuildMember, speaker: GuildSpeaker): boolean {
  return member.voice.channelId === speaker.channelId || member.permissions.has(PermissionFlagsBits.MoveMembers);
}
