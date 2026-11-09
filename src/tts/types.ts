export interface SpeechChunk {
  /** May point at native memory: only valid during the onChunk call, so copy or convert it there. */
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface SynthesisRequest {
  readonly text: string;
  /** Kokoro speaker id. */
  readonly sid: number;
  /** Called once per synthesized sentence batch, in order. */
  readonly onChunk: (chunk: SpeechChunk) => void;
  /** Aborting stops generation after the current chunk. */
  readonly signal?: AbortSignal;
}

export interface TtsEngine {
  synthesize(request: SynthesisRequest): Promise<void>;
}
