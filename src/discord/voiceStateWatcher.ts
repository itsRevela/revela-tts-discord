import type { VoiceState } from 'discord.js';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';

/** Leaves when the bot is kicked from voice or its channel has no people left in it. */
export function handleVoiceStateUpdate(state: VoiceState, speakers: GuildSpeakers, logger: Logger): void {
  const guildId = state.guild.id;
  const speaker = speakers.get(guildId);
  if (!speaker) return;

  if (state.id === state.client.user.id) {
    if (!state.channelId) speakers.disconnect(guildId);
    return;
  }

  const channel = state.guild.channels.cache.get(speaker.channelId);
  if (!channel?.isVoiceBased()) return;
  const listeners = channel.members.filter((member) => !member.user.bot).size;
  if (listeners === 0) {
    logger.info('Voice channel is empty; leaving', { guildId, channelId: speaker.channelId });
    speakers.disconnect(guildId);
  }
}
