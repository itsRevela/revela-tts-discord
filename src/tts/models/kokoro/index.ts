import type { TtsModel } from '../../types.ts';
import { DEFAULT_KOKORO_VOICE_ID, KOKORO_VOICES_BY_GRADE } from './voices.ts';

export const kokoroModel: TtsModel = {
  id: 'kokoro',
  name: 'Kokoro',
  description: 'Clearest voice and fastest; 28 English and 8 Mandarin Chinese preset voices graded A to F',
  voices: KOKORO_VOICES_BY_GRADE,
  defaultVoiceId: DEFAULT_KOKORO_VOICE_ID,
  // Loaded lazily so the voice catalog can be used without the native addon.
  load: async (options) => (await import('./engine.ts')).loadKokoro(options),
};
