import type { Logger } from '../logging/logger.ts';
import { composeUtterance, shouldAnnounce } from '../text/utterance.ts';
import type { TtsEngine } from '../tts/types.ts';
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
  readonly sid: number;
}

export type SpeakResult = 'queued' | 'full';

/** The bot's presence in one guild's voice channel. */
export interface GuildSpeaker {
  readonly channelId: string;
  readonly isFull: boolean;
  speak(input: SpeakInput): SpeakResult;
  skip(): boolean;
}

export interface GuildSpeakerOptions {
  readonly session: VoiceSession;
  readonly engine: TtsEngine;
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
  const { session, engine, logger, maxQueueLength, idleTimeoutMs } = options;
  const queue = new SpeechQueue({ engine, player: session.player, maxLength: maxQueueLength, logger });
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
      if (!queue.enqueue({ text, sid: input.sid })) return 'full';
      lastSpeakerId = input.authorId;
      idle.touch();
      return 'queued';
    },
    skip: () => queue.skip(),
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
