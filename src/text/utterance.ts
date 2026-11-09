export interface AnnounceDecision {
  /** The speaker's own preference (on by default). */
  readonly announcePreference: boolean;
  readonly speakerId: string;
  /** Author of the previous message read aloud in this voice session. */
  readonly previousSpeakerId: string | undefined;
}

/** Name the speaker only when they opted in and someone else spoke last. */
export function shouldAnnounce({ announcePreference, speakerId, previousSpeakerId }: AnnounceDecision): boolean {
  return announcePreference && speakerId !== previousSpeakerId;
}

export interface UtteranceInput {
  readonly text: string;
  readonly speakerName: string | undefined;
  readonly announce: boolean;
}

export function composeUtterance({ text, speakerName, announce }: UtteranceInput): string {
  return announce && speakerName ? `${speakerName} says, ${text}` : text;
}
