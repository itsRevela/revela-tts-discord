import { estimatedWaitSeconds, type BufferState } from './playbackBuffer.ts';

/** Where one queued message stands, for showing progress to the person who sent it. */
export type SpeechStatus =
  /** Waiting for earlier messages to be generated first. */
  | { readonly stage: 'queued'; readonly ahead: number }
  /**
   * Being generated. `progress` (0 to 1) and `secondsLeft` estimate the time
   * until playback can start; both are undefined until anything is known.
   */
  | {
      readonly stage: 'generating';
      readonly ahead: number;
      readonly progress: number | undefined;
      readonly secondsLeft: number | undefined;
    }
  /** Generated enough to play, waiting for earlier messages to finish playing. */
  | { readonly stage: 'ready'; readonly ahead: number }
  | { readonly stage: 'playing' };

export interface StatusInput {
  readonly playing: boolean;
  /** Synthesis has not started yet. */
  readonly pending: boolean;
  /** Messages ahead of this one in the queue. */
  readonly ahead: number;
  readonly buffer: BufferState;
}

/** Fraction of the wait already behind us. */
function progressOf(elapsed: number, wait: number | undefined): number | undefined {
  if (wait === undefined) return undefined;
  const total = elapsed + wait;
  return total > 0 ? elapsed / total : 0;
}

export function speechStatus({ playing, pending, ahead, buffer }: StatusInput): SpeechStatus {
  if (playing) return { stage: 'playing' };
  if (pending) return { stage: 'queued', ahead };
  const wait = estimatedWaitSeconds(buffer);
  const playable = buffer.synthesized || (buffer.chunks > 0 && wait === 0);
  if (playable && ahead > 0) return { stage: 'ready', ahead };
  if (playable) return { stage: 'generating', ahead, progress: 1, secondsLeft: 0 };
  return { stage: 'generating', ahead, progress: progressOf(buffer.elapsedSeconds, wait), secondsLeft: wait };
}
