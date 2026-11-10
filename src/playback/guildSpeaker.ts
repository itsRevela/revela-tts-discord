import type { Logger } from '../logging/logger.ts';
import { composeUtterance, shouldAnnounce } from '../text/utterance.ts';
import type { Synthesizer } from '../tts/synthesizer.ts';
import type { ProductionRates } from './playbackBuffer.ts';
import type { SpeechStatus } from './speechStatus.ts';
import { createIdleTimer } from './idleTimer.ts';
import { SpeechQueue } from './speechQueue.ts';
import type { VoiceSession } from './voiceSession.ts';

export interface SpeakInput {
  readonly authorId: string;
  /** Pronounceable display name, if the author has one. */
  readonly authorName: string | undefined;
  /** The author's "announce my name" preference. */
  readonly announceName: boolean;
  /** Message text already cleaned for speech. */
  readonly text: string;
  readonly model: string;
  readonly voiceId: string;
  /** Called once when this message is finished (played, skipped, or dropped). */
  readonly onDone?: () => void;
  /** Progress updates until playback starts. */
  readonly onStatus?: (status: SpeechStatus) => void;
}

export type SpeakResult = 'queued' | 'full';

/** The bot's presence in one guild's voice channel. */
export interface GuildSpeaker {
  readonly channelId: string;
  readonly isFull: boolean;
  speak(input: SpeakInput): SpeakResult;
  skip(): boolean;
  /** Drops (and stops) everything this person queued. Returns how many messages were dropped. */
  dropAuthor(authorId: string): number;
}

export interface GuildSpeakerOptions {
  readonly session: VoiceSession;
  readonly synthesizer: Synthesizer;
  readonly rates?: ProductionRates;
  readonly logger: Logger;
  readonly maxQueueLength: number;
  /** Leave after this long without new messages; 0 never leaves. */
  readonly idleTimeoutMs: number;
}

export interface GuildSpeakerHandle {
  readonly speaker: GuildSpeaker;
  /** Stops the idle timer and drops queued speech; does not touch the connection. */
  readonly close: () => void;
}

/** Wires a voice session to a speech queue, the "<name> says" rule and the idle timeout. */
export function createGuildSpeaker(options: GuildSpeakerOptions): GuildSpeakerHandle {
  const { session, synthesizer, rates, logger, maxQueueLength, idleTimeoutMs } = options;
  const queue = new SpeechQueue({ synthesizer, player: session.player, maxLength: maxQueueLength, logger, ...(rates ? { rates } : {}) });
  const idle = createIdleTimer(idleTimeoutMs, () => queue.size > 0, () => {
    logger.info('Leaving voice channel after inactivity', { guildId: session.guildId });
    session.destroy();
  });
  let lastSpeakerId: string | undefined;

  const speaker: GuildSpeaker = {
    get channelId() {
      return session.channelId;
    },
    get isFull() {
      return queue.isFull;
    },
    speak: (input) => {
      const announce = shouldAnnounce({
        announcePreference: input.announceName,
        speakerId: input.authorId,
        previousSpeakerId: lastSpeakerId,
      });
      const text = composeUtterance({ text: input.text, speakerName: input.authorName, announce });
      const request = {
        text,
        model: input.model,
        voiceId: input.voiceId,
        authorId: input.authorId,
        ...(input.onDone ? { onDone: input.onDone } : {}),
        ...(input.onStatus ? { onStatus: input.onStatus } : {}),
      };
      if (!queue.enqueue(request)) return 'full';
      lastSpeakerId = input.authorId;
      idle.touch();
      return 'queued';
    },
    skip: () => queue.skip(),
    dropAuthor: (authorId) => queue.dropAuthor(authorId),
  };

  idle.touch();
  return {
    speaker,
    close: () => {
      idle.cancel();
      queue.close();
    },
  };
}
