// Minimal typings for the parts of sherpa-onnx-node 1.13.x this bot uses.
// The package ships JSDoc only (see node_modules/sherpa-onnx-node/types.js).
declare module 'sherpa-onnx-node' {
  export interface OfflineTtsKokoroModelConfig {
    model: string;
    voices: string;
    tokens: string;
    dataDir?: string;
    /** Jieba dictionary folder, needed for Chinese. */
    dictDir?: string;
    /** Comma-separated lexicon files. */
    lexicon?: string;
    lang?: string;
    lengthScale?: number;
  }

  export interface OfflineTtsPocketModelConfig {
    lmFlow: string;
    lmMain: string;
    encoder: string;
    decoder: string;
    textConditioner: string;
    vocabJson: string;
    tokenScoresJson: string;
    /** How many reference-voice embeddings to keep cached. */
    voiceEmbeddingCacheCapacity?: number;
  }

  export interface OfflineTtsConfig {
    model: {
      kokoro?: OfflineTtsKokoroModelConfig;
      pocket?: OfflineTtsPocketModelConfig;
      numThreads?: number;
      provider?: 'cpu';
      debug?: boolean;
    };
    maxNumSentences?: number;
    silenceScale?: number;
    /** Comma-separated text-normalization FSTs. */
    ruleFsts?: string;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface TtsProgress {
    /** Audio generated since the previous callback. */
    samples: Float32Array;
    progress: number;
  }

  export interface GenerationConfigOptions {
    speed?: number;
    sid?: number;
    numSteps?: number;
    silenceScale?: number;
    referenceAudio?: Float32Array;
    referenceSampleRate?: number;
    referenceText?: string;
    extra?: Record<string, number | string>;
  }

  export class GenerationConfig {
    constructor(options: GenerationConfigOptions);
  }

  export interface TtsAsyncRequest {
    text: string;
    sid?: number;
    speed?: number;
    generationConfig?: GenerationConfig;
    /** Return 0 or false to stop generation early. */
    onProgress?: (info: TtsProgress) => number | boolean | void;
  }

  export class OfflineTts {
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly sampleRate: number;
    readonly numSpeakers: number;
    generateAsync(request: TtsAsyncRequest): Promise<GeneratedAudio>;
  }

  export class LinearResampler {
    constructor(inputSampleRate: number, outputSampleRate: number);
    /** Resamples a final chunk and flushes buffered samples. */
    flush(samples: Float32Array): Float32Array;
  }

  export interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  const sherpa: {
    OfflineTts: typeof OfflineTts;
    GenerationConfig: typeof GenerationConfig;
    LinearResampler: typeof LinearResampler;
    readWave(filename: string): Wave;
  };
  export default sherpa;
}
