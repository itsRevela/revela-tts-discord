import { PassThrough, type Readable } from 'node:stream';
import { toDiscordPcm } from '../audio/pcm.ts';
import type { Logger } from '../logging/logger.ts';
import type { Synthesizer } from '../tts/synthesizer.ts';
import type { SpeechChunk } from '../tts/types.ts';
import {
  DEFAULT_SECONDS_PER_CHARACTER,
  ProductionRates,
  overallRate,
  remainingWaitSeconds,
  type BufferState,
} from './playbackBuffer.ts';
import { speechStatus, type SpeechStatus } from './speechStatus.ts';

/** While a slow model buffers, recheck at least this often (a pause between pieces sends no chunks). */
const RECHECK_MS = 250;

/** Plays one message's PCM stream; resolves when the stream ends or playback is stopped. */
export interface SpeechPlayer {
  play(pcm: Readable): Promise<void>;
  stop(): void;
}

export interface SpeechRequest {
  readonly text: string;
  readonly model: string;
  readonly voiceId: string;
  /** Called once when the message leaves the queue: played, skipped, failed, or dropped. */
  readonly onDone?: () => void;
  /** Called as the message moves through the queue, ending with "playing" when playback starts. */
  readonly onStatus?: (status: SpeechStatus) => void;
}

export interface SpeechQueueOptions {
  readonly synthesizer: Synthesizer;
  readonly player: SpeechPlayer;
  readonly maxLength: number;
  readonly logger: Logger;
  /** Shared memory of how fast each model produces audio. */
  readonly rates?: ProductionRates;
  /** Clock in seconds; injectable for tests. */
  readonly now?: () => number;
}

type UtteranceStatus = 'pending' | 'synthesizing' | 'synthesized';

interface Utterance {
  readonly request: SpeechRequest;
  readonly abort: AbortController;
  status: UtteranceStatus;
  /** Audio generated before playback of this message started. */
  buffered: readonly Buffer[];
  /** Once playing, new audio is written here so the message plays as one continuous stream. */
  sink: PassThrough | undefined;
  chunks: number;
  /** Seconds of audio received so far. */
  receivedSeconds: number;
  /** When synthesis of this message started, on the queue's clock. */
  startedAt: number | undefined;
  finished: boolean;
}

/**
 * Per-guild speech pipeline. Synthesis runs ahead of playback, and each message
 * plays as one continuous stream. Models faster than real time start on their
 * first chunk; slower ones wait until the rest of the message can be generated
 * within its own playing time (see playbackBuffer.ts).
 */
export class SpeechQueue {
  readonly #options: SpeechQueueOptions;
  readonly #rates: ProductionRates;
  readonly #now: () => number;
  #utterances: readonly Utterance[] = [];
  #synthesizing = false;
  #playing = false;
  #closed = false;
  #recheck: NodeJS.Timeout | undefined;

  constructor(options: SpeechQueueOptions) {
    this.#options = options;
    this.#rates = options.rates ?? new ProductionRates();
    this.#now = options.now ?? (() => performance.now() / 1000);
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
    const utterance: Utterance = {
      request,
      abort: new AbortController(),
      status: 'pending',
      buffered: [],
      sink: undefined,
      chunks: 0,
      receivedSeconds: 0,
      startedAt: undefined,
      finished: false,
    };
    this.#utterances = [...this.#utterances, utterance];
    this.#report(utterance);
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
    clearTimeout(this.#recheck);
    for (const utterance of this.#utterances) {
      this.#cancel(utterance);
      this.#finish(utterance);
    }
    this.#utterances = [];
    this.#options.player.stop();
  }

  #cancel(utterance: Utterance): void {
    utterance.abort.abort();
    utterance.sink?.end();
  }

  #remove(utterance: Utterance): void {
    this.#cancel(utterance);
    this.#utterances = this.#utterances.filter((candidate) => candidate !== utterance);
    this.#finish(utterance);
    for (const remaining of this.#utterances) this.#report(remaining); // everyone moved up
  }

  /** Tells the message's sender where it stands. */
  #report(utterance: Utterance): void {
    const { onStatus } = utterance.request;
    if (!onStatus || utterance.finished) return;
    const status = speechStatus({
      playing: utterance.sink !== undefined,
      pending: utterance.status === 'pending',
      ahead: Math.max(this.#utterances.indexOf(utterance), 0),
      buffer: this.#bufferState(utterance),
    });
    try {
      onStatus(status);
    } catch (error: unknown) {
      this.#options.logger.warn('A message status callback failed', { error });
    }
  }

  #finish(utterance: Utterance): void {
    if (utterance.finished) return;
    utterance.finished = true;
    try {
      utterance.request.onDone?.();
    } catch (error: unknown) {
      this.#options.logger.warn('A finished-message callback failed', { error });
    }
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
    utterance.startedAt = this.#now();
    this.#report(utterance);
    const onChunk = (chunk: SpeechChunk): void => {
      if (utterance.abort.signal.aborted) return;
      const seconds = chunk.samples.length / chunk.sampleRate;
      const pcm = toDiscordPcm(chunk.samples, chunk.sampleRate);
      utterance.chunks += 1;
      utterance.receivedSeconds += seconds;
      this.#report(utterance);
      if (utterance.sink) {
        utterance.sink.write(pcm);
      } else {
        utterance.buffered = [...utterance.buffered, pcm];
        void this.#pumpPlayback();
      }
    };
    const { text, model, voiceId } = utterance.request;
    try {
      await this.#options.synthesizer.synthesize({ text, model, voiceId, onChunk, signal: utterance.abort.signal });
    } catch (error: unknown) {
      this.#options.logger.error('Speech synthesis failed', { error, model, characters: text.length });
    } finally {
      utterance.status = 'synthesized';
      this.#recordRate(utterance);
      this.#report(utterance);
      utterance.sink?.end();
      void this.#pumpPlayback();
    }
  }

  #elapsed(utterance: Utterance): number {
    return utterance.startedAt === undefined ? 0 : this.#now() - utterance.startedAt;
  }

  #recordRate(utterance: Utterance): void {
    if (utterance.abort.signal.aborted) return;
    const { model, voiceId, text } = utterance.request;
    const rate = overallRate(utterance.receivedSeconds, this.#elapsed(utterance));
    if (rate !== undefined) this.#rates.record(model, rate);
    if (utterance.receivedSeconds > 0 && text.length > 0) {
      this.#rates.recordPace(model, voiceId, utterance.receivedSeconds / text.length);
    }
  }

  #bufferState(utterance: Utterance): BufferState {
    const { model, voiceId, text } = utterance.request;
    return {
      synthesized: utterance.status === 'synthesized',
      chunks: utterance.chunks,
      elapsedSeconds: this.#elapsed(utterance),
      receivedSeconds: utterance.receivedSeconds,
      textLength: text.length,
      historicalRate: this.#rates.get(model),
      secondsPerCharacter: this.#rates.pace(model, voiceId) ?? DEFAULT_SECONDS_PER_CHARACTER,
    };
  }

  /** True when the message may start; otherwise schedules another check. */
  #isReady(utterance: Utterance): boolean {
    const wait = remainingWaitSeconds(this.#bufferState(utterance));
    if (wait === 0) return true;
    this.#report(utterance); // keeps the progress display moving while buffering
    if (wait !== undefined && !this.#closed) {
      clearTimeout(this.#recheck);
      this.#recheck = setTimeout(() => void this.#pumpPlayback(), Math.min(wait * 1000, RECHECK_MS));
      this.#recheck.unref();
    }
    return false;
  }

  async #pumpPlayback(): Promise<void> {
    if (this.#playing) return;
    this.#playing = true;
    try {
      for (let head = this.#utterances[0]; head; head = this.#utterances[0]) {
        if (head.buffered.length > 0 && this.#isReady(head)) {
          await this.#play(head);
          this.#remove(head);
        } else if (head.buffered.length === 0 && head.status === 'synthesized') {
          this.#remove(head); // Produced no audio.
        } else {
          break; // Still buffering; each new chunk checks again.
        }
      }
    } finally {
      this.#playing = false;
    }
  }

  async #play(utterance: Utterance): Promise<void> {
    const sink = new PassThrough();
    for (const pcm of utterance.buffered) sink.write(pcm);
    utterance.buffered = [];
    utterance.sink = sink;
    this.#report(utterance);
    if (utterance.status === 'synthesized' || utterance.abort.signal.aborted) sink.end();
    try {
      await this.#options.player.play(sink);
    } catch (error: unknown) {
      this.#options.logger.error('Audio playback failed', { error });
    }
  }
}
