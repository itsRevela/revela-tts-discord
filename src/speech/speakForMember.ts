import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeaker, GuildSpeakers } from '../playback/guildSpeakers.ts';
import type { SpeechStatus } from '../playback/speechStatus.ts';
import type { PreferenceStore } from '../preferences/preferenceStore.ts';
import { speakableName } from '../text/speakableName.ts';
import { QUEUE_FULL, busyElsewhere } from './preflight.ts';

export interface SpeechCallbacks {
  /** Called once when the message is finished: played, skipped, or dropped. */
  readonly onDone: () => void;
  /** Progress until playback starts. */
  readonly onStatus: (status: SpeechStatus) => void;
}

export interface SpeakDependencies {
  readonly speakers: GuildSpeakers;
  readonly preferences: PreferenceStore;
  readonly logger: Logger;
}

/**
 * Joins `channel` if needed and queues `spoken` in the member's model, voice
 * and announce setting. Returns a problem to report instead, if any.
 */
export async function speakForMember(
  member: GuildMember,
  channel: VoiceBasedChannel,
  spoken: string,
  callbacks: SpeechCallbacks,
  { speakers, preferences, logger }: SpeakDependencies,
): Promise<string | undefined> {
  let speaker: GuildSpeaker;
  try {
    speaker = await speakers.connect(channel);
  } catch (error: unknown) {
    logger.error('Failed to join voice channel', { error, guildId: channel.guild.id, channelId: channel.id });
    return "I couldn't join the voice channel. Try again in a moment.";
  }
  if (speaker.channelId !== channel.id) return busyElsewhere(speaker.channelId);

  const { user } = member;
  const choice = preferences.get(user.id);
  const result = speaker.speak({
    authorId: user.id,
    authorName: speakableName(member.displayName) ?? speakableName(user.username),
    announceName: choice.announceName,
    text: spoken,
    model: choice.model,
    voiceId: choice.voice,
    ...callbacks,
  });
  return result === 'full' ? QUEUE_FULL : undefined;
}
