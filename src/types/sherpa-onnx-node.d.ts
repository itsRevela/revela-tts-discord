// Minimal typings for the parts of sherpa-onnx-node 1.13.x this bot uses.
// The package ships JSDoc only (see node_modules/sherpa-onnx-node/types.js).
declare module 'sherpa-onnx-node' {
  export interface OfflineTtsKokoroModelConfig {
    model: string;
    voices: string;
    tokens: string;
    dataDir?: string;
    lexicon?: string;
    lang?: string;
    lengthScale?: number;
  }

  export interface OfflineTtsConfig {
    model: {
      kokoro: OfflineTtsKokoroModelConfig;
      numThreads?: number;
      provider?: 'cpu';
      debug?: boolean;
    };
    maxNumSentences?: number;
    silenceScale?: number;
  }

  export interface GeneratedAudio {
    samples: Float32Array;
    sampleRate: number;
  }

  export interface TtsProgress {
    /** Audio for the chunk (sentence batch) that just finished. */
    samples: Float32Array;
    progress: number;
  }

  export interface TtsAsyncRequest {
    text: string;
    sid: number;
    speed: number;
    /** Return 0 or false to stop generation early. */
    onProgress?: (info: TtsProgress) => number | boolean | void;
  }

  export class OfflineTts {
    static createAsync(config: OfflineTtsConfig): Promise<OfflineTts>;
    readonly sampleRate: number;
    readonly numSpeakers: number;
    generateAsync(request: TtsAsyncRequest): Promise<GeneratedAudio>;
  }

  const sherpa: { OfflineTts: typeof OfflineTts };
  export default sherpa;
}
