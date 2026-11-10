import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';

export const QUEUE_FULL = 'The speech queue is full. Give it a moment to catch up.';

export type Preflight = { readonly problem: string } | { readonly channel: VoiceBasedChannel };

export function busyElsewhere(channelId: string): string {
  return `I'm already talking in <#${channelId}>. Join that channel, or use /leave there first.`;
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

/**
 * Checks everything about speaking for `member` that can be answered
 * instantly, before any slow work: they are in a voice channel the bot can
 * use, the bot is not busy elsewhere, and the queue has room.
 */
export function preflight(member: GuildMember, guild: Guild, speakers: GuildSpeakers): Preflight {
  const channel = member.voice.channel;
  if (!channel) return { problem: 'Join a voice channel first, then use /tts.' };
  const existing = speakers.get(guild.id);
  if (existing && existing.channelId !== channel.id) return { problem: busyElsewhere(existing.channelId) };
  if (existing?.isFull) return { problem: QUEUE_FULL };
  const problem = existing ? undefined : voiceChannelProblem(channel, guild.members.me);
  return problem ? { problem } : { channel };
}
