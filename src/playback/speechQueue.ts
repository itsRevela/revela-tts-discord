import { toDiscordPcm } from '../audio/pcm.ts';
import type { Logger } from '../logging/logger.ts';
import type { SpeechChunk, TtsEngine } from '../tts/types.ts';

/** Plays one PCM clip; resolves when it finishes or is stopped. */
export interface ClipPlayer {
  play(pcm: Buffer): Promise<void>;
  stop(): void;
}

export interface SpeechRequest {
  readonly text: string;
  readonly sid: number;
}

export interface SpeechQueueOptions {
  readonly engine: TtsEngine;
  readonly player: ClipPlayer;
  readonly maxLength: number;
  readonly logger: Logger;
}

type UtteranceStatus = 'pending' | 'synthesizing' | 'synthesized';

interface Utterance {
  readonly request: SpeechRequest;
  readonly abort: AbortController;
  status: UtteranceStatus;
  /** Sentence clips synthesized but not yet played, in order. */
  clips: readonly Buffer[];
}

/**
 * Per-guild speech pipeline. Synthesis runs ahead of playback, one sentence at
 * a time, so the first sentence plays while later ones (and later messages)
 * are still being generated.
 */
export class SpeechQueue {
  readonly #options: SpeechQueueOptions;
  #utterances: readonly Utterance[] = [];
  #synthesizing = false;
  #playing = false;
  #closed = false;

  constructor(options: SpeechQueueOptions) {
    this.#options = options;
  }

  /** Messages waiting or playing, including the current one. */
  get size(): number {
    return this.#utterances.length;
  }

  get isFull(): boolean {
    return this.#utterances.length >= this.#options.maxLength;
  }

  /** Returns false when the queue is full or closed. */
  enqueue(request: SpeechRequest): boolean {
    if (this.#closed || this.isFull) return false;
    const utterance: Utterance = { request, abort: new AbortController(), status: 'pending', clips: [] };
    this.#utterances = [...this.#utterances, utterance];
    void this.#pumpSynthesis();
    return true;
  }

  /** Stops the message currently playing. Returns false if nothing was queued. */
  skip(): boolean {
    const head = this.#utterances[0];
    if (!head) return false;
    this.#remove(head);
    this.#options.player.stop();
    return true;
  }

  /** Drops everything and refuses new messages. */
  close(): void {
    this.#closed = true;
    for (const utterance of this.#utterances) utterance.abort.abort();
    this.#utterances = [];
    this.#options.player.stop();
  }

  #remove(utterance: Utterance): void {
    utterance.abort.abort();
    this.#utterances = this.#utterances.filter((candidate) => candidate !== utterance);
  }

  async #pumpSynthesis(): Promise<void> {
    if (this.#synthesizing) return;
    this.#synthesizing = true;
    try {
      let next = this.#utterances.find((utterance) => utterance.status === 'pending');
      while (next) {
        await this.#synthesize(next);
        next = this.#utterances.find((utterance) => utterance.status === 'pending');
      }
    } finally {
      this.#synthesizing = false;
    }
  }

  async #synthesize(utterance: Utterance): Promise<void> {
    utterance.status = 'synthesizing';
    const onChunk = (chunk: SpeechChunk): void => {
      if (utterance.abort.signal.aborted) return;
      utterance.clips = [...utterance.clips, toDiscordPcm(chunk.samples, chunk.sampleRate)];
      void this.#pumpPlayback();
    };
    try {
      await this.#options.engine.synthesize({
        text: utterance.request.text,
        sid: utterance.request.sid,
        onChunk,
        signal: utterance.abort.signal,
      });
    } catch (error: unknown) {
      this.#options.logger.error('Speech synthesis failed', { error, characters: utterance.request.text.length });
    } finally {
      utterance.status = 'synthesized';
      void this.#pumpPlayback();
    }
  }

  async #pumpPlayback(): Promise<void> {
    if (this.#playing) return;
    this.#playing = true;
    try {
      for (let head = this.#utterances[0]; head; head = this.#utterances[0]) {
        const [clip, ...rest] = head.clips;
        if (clip) {
          head.clips = rest;
          await this.#play(clip);
        } else if (head.status === 'synthesized') {
          this.#remove(head);
        } else {
          break; // Waiting for the next sentence; onChunk restarts playback.
        }
      }
    } finally {
      this.#playing = false;
    }
  }

  async #play(clip: Buffer): Promise<void> {
    try {
      await this.#options.player.play(clip);
    } catch (error: unknown) {
      this.#options.logger.error('Audio playback failed', { error });
    }
  }
}
