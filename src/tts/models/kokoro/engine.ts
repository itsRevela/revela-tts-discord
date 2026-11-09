import sherpa from 'sherpa-onnx-node';
import { streamGeneration } from '../../sherpa/streamGeneration.ts';
import type { ModelLoadOptions, TtsEngine } from '../../types.ts';
import { kokoroConfig } from './config.ts';
import { DEFAULT_KOKORO_VOICE_ID, KOKORO_VOICES_BY_GRADE, findKokoroVoice } from './voices.ts';

export async function loadKokoro(options: ModelLoadOptions): Promise<TtsEngine> {
  const tts = await sherpa.OfflineTts.createAsync(kokoroConfig(options));
  return {
    voices: KOKORO_VOICES_BY_GRADE,
    synthesize: ({ text, voiceId, onChunk, signal }) => {
      const voice = findKokoroVoice(voiceId) ?? findKokoroVoice(DEFAULT_KOKORO_VOICE_ID);
      return streamGeneration(tts, { text, sid: voice?.sid ?? 0, speed: options.speed }, onChunk, signal);
    },
  };
}
