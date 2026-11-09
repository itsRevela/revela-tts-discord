import type { Logger } from '../logging/logger.ts';

export interface SpeechChunk {
  /** May point at native memory: only valid during the onChunk call, so copy or convert it there. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface SynthesisRequest {
  readonly text: string;
  /** A voice id from the model's catalog. */
  readonly voiceId: string;
  /** Called for each piece of audio as it is generated, in order. */
  readonly onChunk: (chunk: SpeechChunk) => void;
  /** Aborting stops generation after the current chunk. */
  readonly signal?: AbortSignal;
}

export interface Voice {
  readonly id: string;
  /** Shown in /voice, e.g. "Heart (American female) · grade A". */
  readonly label: string;
  /** Cloned from a recording someone added (listed by /customvoice, not /voice). */
  readonly custom?: boolean;
  /** Language the voice was trained on, e.g. "en" or "zh"; used to keep every language visible in /voice. */
  readonly language?: string;
  /** Sub-group within a model and language, e.g. "Characters"; gets its own /voice filter. */
  readonly category?: string;
  /** One line about how the voice sounds, shown under it in the /voice picker. */
  readonly description?: string;
}

/** A loaded model, ready to synthesize. */
export interface TtsEngine {
  /** Voices actually available: the catalog ones that loaded, plus any custom ones. */
  readonly voices: readonly Voice[];
  synthesize(request: SynthesisRequest): Promise<void>;
}

export interface ModelLoadOptions {
  /** This model's folder, e.g. /models/kokoro. */
  readonly modelDir: string;
  /** Recordings to clone, for models that can (e.g. /data/voices/pocket). */
  readonly customVoicesDir: string;
  /** Environment, for model-specific settings such as a server address. Each model validates its own. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly numThreads: number;
  readonly speed: number;
  readonly logger: Logger;
}

/**
 * A pluggable TTS model. Each model lives in its own folder under
 * src/tts/models/ and is listed once in modelRegistry.ts. Definitions are
 * static so commands and config can use the voice catalog without loading
 * any weights.
 */
export interface TtsModel {
  /** Also the folder name under the models directory. */
  readonly id: string;
  readonly name: string;
  /** One-line summary of the model. */
  readonly description: string;
  /** Built-in catalog, best first; autocomplete shows the first 25 matches. */
  readonly voices: readonly Voice[];
  readonly defaultVoiceId: string;
  /**
   * Runs in another container. Unless it is the default model, it loads in the
   * background and joins /voice once its server is ready, so a slow first
   * download or a missing server never holds up the bot.
   */
  readonly remote?: boolean;
  load(options: ModelLoadOptions): Promise<TtsEngine>;
}
