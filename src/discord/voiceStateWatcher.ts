import type { VoiceState } from 'discord.js';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';

/**
 * Leaves when the bot is kicked from voice or its channel has no people left
 * in it. Speech only plays for people in the bot's channel, so anyone who is
 * not there (they left or moved) has their queued messages dropped, and their
 * current one stopped.
 */
export function handleVoiceStateUpdate(state: VoiceState, speakers: GuildSpeakers, logger: Logger): void {
  const guildId = state.guild.id;
  const speaker = speakers.get(guildId);
  if (!speaker) return;

  if (state.id === state.client.user.id) {
    if (!state.channelId) speakers.disconnect(guildId);
    return;
  }

  if (state.channelId !== speaker.channelId) {
    const dropped = speaker.dropAuthor(state.id);
    if (dropped > 0) logger.info('Dropped speech from someone who left the channel', { guildId, dropped });
  }

  const channel = state.guild.channels.cache.get(speaker.channelId);
  if (!channel?.isVoiceBased()) return;
  const listeners = channel.members.filter((member) => !member.user.bot).size;
  if (listeners === 0) {
    logger.info('Voice channel is empty; leaving', { guildId, channelId: speaker.channelId });
    speakers.disconnect(guildId);
  }
}
