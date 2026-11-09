import path from 'node:path';
import type { OfflineTtsConfig } from 'sherpa-onnx-node';

export interface KokoroConfigOptions {
  readonly modelDir: string;
  readonly numThreads: number;
}

/**
 * English + Mandarin config for sherpa-onnx's `kokoro-multi-lang-v1_0` model.
 * Chinese characters go through the Chinese lexicon (jieba word splitting plus
 * date/phone/number rules); everything else is phonemized by espeak-ng, since
 * the model's metadata sets voice=en-us. That espeak-ng dependency is why
 * sherpa-onnx-node is pinned to 1.13.x. Without the Chinese lexicon, Chinese
 * text is silently dropped. fp32 `model.onnx` is used on purpose: on AVX2 CPUs
 * without VNNI the int8 build benchmarked about 2x slower.
 */
export function kokoroConfig(options: KokoroConfigOptions): OfflineTtsConfig {
  const file = (name: string): string => path.join(options.modelDir, name);
  return {
    model: {
      kokoro: {
        model: file('model.onnx'),
        voices: file('voices.bin'),
        tokens: file('tokens.txt'),
        dataDir: file('espeak-ng-data'),
        dictDir: file('dict'),
        lexicon: [file('lexicon-us-en.txt'), file('lexicon-zh.txt')].join(','),
      },
      numThreads: options.numThreads,
      provider: 'cpu',
      debug: false,
    },
    ruleFsts: [file('date-zh.fst'), file('phone-zh.fst'), file('number-zh.fst')].join(','),
    // One sentence per chunk, so playback can start after the first sentence.
    maxNumSentences: 1,
  };
}
