import path from 'node:path';
import type { OfflineTtsConfig } from 'sherpa-onnx-node';

/** fp32 sounds best; int8 is about 35% faster on the Ryzen 5 5500. */
export type PocketVariant = 'fp32' | 'int8';

/**
 * Flow-matching steps per frame. 10 steps scored no better than 5 on speaker
 * similarity and cost about 12% more time.
 */
export const POCKET_NUM_STEPS = 5;
/**
 * Sampling temperature (sherpa's default is 0.7). On the server's custom
 * voices, speaker similarity was 0.648 at 0.3, 0.681 at 0.7, 0.704 at 0.9 and
 * 0.701 at 1.0, so 0.9 sounds most like the person.
 */
export const POCKET_TEMPERATURE = 0.9;
/**
 * Upper bound passed to sherpa. In practice this ONNX export's encoder only
 * reads about the first 1.04 s of a recording (a 2 s and a 22 s clip give
 * identical output), so the start of each recording is what gets cloned.
 */
export const POCKET_MAX_REFERENCE_SECONDS = 12;

export interface PocketConfigOptions {
  readonly modelDir: string;
  readonly variant: PocketVariant;
  readonly numThreads: number;
  /** Cache one embedding per catalog voice so each is computed once. */
  readonly voiceCount: number;
}

/** The files of the quantized variant carry an `.int8` suffix; the rest are shared. */
export function pocketConfig(options: PocketConfigOptions): OfflineTtsConfig {
  const file = (name: string): string => path.join(options.modelDir, name);
  const quantized = (name: string): string => file(options.variant === 'int8' ? `${name}.int8.onnx` : `${name}.onnx`);
  return {
    model: {
      pocket: {
        lmFlow: quantized('lm_flow'),
        lmMain: quantized('lm_main'),
        encoder: file('encoder.onnx'),
        decoder: quantized('decoder'),
        textConditioner: file('text_conditioner.onnx'),
        vocabJson: file('vocab.json'),
        tokenScoresJson: file('token_scores.json'),
        voiceEmbeddingCacheCapacity: options.voiceCount,
      },
      numThreads: options.numThreads,
      provider: 'cpu',
      debug: false,
    },
    maxNumSentences: 1,
  };
}
