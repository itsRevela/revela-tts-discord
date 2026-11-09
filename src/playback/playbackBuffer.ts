/**
 * Decides when a message can start playing without running dry.
 *
 * Let A be the message's total audio and T the total time to generate it,
 * counted from when synthesis started (so startup and any pauses between
 * pieces are included). If playback starts at time T - A, it ends exactly when
 * generation does. And because a model slower than real time never produces
 * audio faster than playback consumes it, playback started then never catches
 * up with generation earlier either, however uneven the chunks are.
 *
 * With the overall rate R = A / T, the start condition is
 *   elapsed >= A * (1 / R - 1)
 * A comes from the text length and the voice's speaking pace. R is the lower of
 * the rate measured on this message so far and the model's remembered rate.
 * Models at or above real time start on their first chunk.
 */

/**
 * Seconds of audio per character before a voice's pace has been measured.
 * Deliberately slow: NeuTTS measured 0.06 (MoistCr1tikal) to 0.124 (rekp).
 */
export const DEFAULT_SECONDS_PER_CHARACTER = 0.13;
/** Extra wait to absorb estimate errors. */
export const SAFETY_FACTOR = 1.2;
/** History weight for a newly measured value. */
const SMOOTHING = 0.5;

export interface BufferState {
  readonly synthesized: boolean;
  readonly chunks: number;
  /** Seconds since synthesis of this message started. */
  readonly elapsedSeconds: number;
  /** Seconds of audio received so far. */
  readonly receivedSeconds: number;
  readonly textLength: number;
  /** This model's overall rate on earlier messages, if any. */
  readonly historicalRate: number | undefined;
  /** The voice's speaking pace, measured or the default. */
  readonly secondsPerCharacter: number;
}

/** Audio per second since synthesis started; undefined before any time has passed. */
export function overallRate(receivedSeconds: number, elapsedSeconds: number): number | undefined {
  if (elapsedSeconds <= 0 || receivedSeconds <= 0) return undefined;
  return receivedSeconds / elapsedSeconds;
}

/** How long after synthesis starts playback must wait (0 for models at or above real time). */
export function requiredWaitSeconds(totalAudioSeconds: number, rate: number): number {
  if (!(rate > 0) || rate >= 1) return 0;
  return totalAudioSeconds * (1 / rate - 1) * SAFETY_FACTOR;
}

/** The rate to plan with: the more cautious of this message's and the model's history. */
export function planningRate(state: BufferState): number | undefined {
  const live = overallRate(state.receivedSeconds, state.elapsedSeconds);
  const known = [live, state.historicalRate].filter((rate): rate is number => rate !== undefined);
  return known.length > 0 ? Math.min(...known) : undefined;
}

/**
 * Best estimate of the seconds until playback may start, for progress displays.
 * Before any audio arrives it relies on the model's history; undefined when
 * nothing is known yet.
 */
export function estimatedWaitSeconds(state: BufferState): number | undefined {
  if (state.synthesized) return 0;
  const rate = planningRate(state);
  if (rate === undefined) return undefined;
  const wait = requiredWaitSeconds(state.textLength * state.secondsPerCharacter, rate);
  return Math.max(wait - state.elapsedSeconds, 0);
}

/** Seconds still to wait before playback may start; 0 when ready, undefined when unknown. */
export function remainingWaitSeconds(state: BufferState): number | undefined {
  if (state.synthesized) return 0;
  if (state.chunks === 0) return undefined;
  return estimatedWaitSeconds(state);
}

export function readyToPlay(state: BufferState): boolean {
  return remainingWaitSeconds(state) === 0;
}

const smooth = (previous: number | undefined, next: number): number =>
  previous === undefined ? next : previous * (1 - SMOOTHING) + next * SMOOTHING;

/** What ProductionRates remembers, as saved to disk. */
export interface RatesSnapshot {
  readonly rates: Readonly<Record<string, number>>;
  readonly paces: Readonly<Record<string, number>>;
}

/** Remembers each model's overall rate and each voice's speaking pace across messages. */
export class ProductionRates {
  readonly #rates: Map<string, number>;
  readonly #paces: Map<string, number>;
  readonly #onChange: (() => void) | undefined;

  constructor(snapshot?: RatesSnapshot, onChange?: () => void) {
    this.#rates = new Map(Object.entries(snapshot?.rates ?? {}));
    this.#paces = new Map(Object.entries(snapshot?.paces ?? {}));
    this.#onChange = onChange;
  }

  snapshot(): RatesSnapshot {
    return { rates: Object.fromEntries(this.#rates), paces: Object.fromEntries(this.#paces) };
  }

  get(model: string): number | undefined {
    return this.#rates.get(model);
  }

  record(model: string, rate: number): void {
    if (!(rate > 0)) return;
    this.#rates.set(model, smooth(this.#rates.get(model), rate));
    this.#onChange?.();
  }

  /** Seconds of audio per character for this voice, or for the model if the voice is new. */
  pace(model: string, voice: string): number | undefined {
    return this.#paces.get(`${model}:${voice}`) ?? this.#paces.get(model);
  }

  recordPace(model: string, voice: string, secondsPerCharacter: number): void {
    if (!(secondsPerCharacter > 0)) return;
    for (const key of [`${model}:${voice}`, model]) this.#paces.set(key, smooth(this.#paces.get(key), secondsPerCharacter));
    this.#onChange?.();
  }
}
