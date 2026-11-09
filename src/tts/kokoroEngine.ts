import path from 'node:path';
import sherpa, { type OfflineTts, type OfflineTtsConfig } from 'sherpa-onnx-node';
import { serialize } from '../util/serialize.ts';
import type { SynthesisRequest, TtsEngine } from './types.ts';

export interface KokoroEngineOptions {
  readonly modelDir: string;
  readonly numThreads: number;
  readonly speed: number;
}

/**
 * English-only config for sherpa-onnx's `kokoro-multi-lang-v1_0` model: the US
 * English lexicon handles known words and espeak-ng covers anything missing
 * (names, slang), which is why sherpa-onnx-node is pinned to 1.13.x.
 */
export function kokoroConfig(options: KokoroEngineOptions): OfflineTtsConfig {
  const file = (name: string): string => path.join(options.modelDir, name);
  return {
    model: {
      kokoro: {
        model: file('model.onnx'),
        voices: file('voices.bin'),
        tokens: file('tokens.txt'),
        dataDir: file('espeak-ng-data'),
        lexicon: file('lexicon-us-en.txt'),
        lang: 'en-us',
      },
      numThreads: options.numThreads,
      provider: 'cpu',
      debug: false,
    },
    // One sentence per chunk, so playback can start after the first sentence.
    maxNumSentences: 1,
  };
}

async function generate(tts: OfflineTts, speed: number, request: SynthesisRequest): Promise<void> {
  const { text, sid, onChunk, signal } = request;
  if (signal?.aborted) return;
  let emitted = false;
  const audio = await tts.generateAsync({
    text,
    sid,
    speed,
    onProgress: (info) => {
      if (signal?.aborted) return 0;
      emitted = true;
      onChunk({ samples: info.samples, sampleRate: tts.sampleRate });
      return signal?.aborted ? 0 : 1;
    },
  });
  // Defensive: if no progress callback fired, deliver the whole result at once.
  if (!emitted && !signal?.aborted && audio.samples.length > 0) {
    onChunk({ samples: audio.samples, sampleRate: audio.sampleRate });
  }
}

export async function createKokoroEngine(options: KokoroEngineOptions): Promise<TtsEngine> {
  const tts = await sherpa.OfflineTts.createAsync(kokoroConfig(options));
  // One OfflineTts instance is not safe for concurrent generation.
  const synthesize = serialize((request: SynthesisRequest) => generate(tts, options.speed, request));
  return { synthesize };
}
