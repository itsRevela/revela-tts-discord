import type { TtsModel } from '../../types.ts';
import { DEFAULT_POCKET_VOICE_ID, POCKET_VOICES } from './voices.ts';

export const pocketModel: TtsModel = {
  id: 'pocket',
  name: 'Pocket TTS',
  description: "Kyutai's voice-cloning model; 21 voices cloned from real recordings, a little slower",
  voices: POCKET_VOICES,
  defaultVoiceId: DEFAULT_POCKET_VOICE_ID,
  // Loaded lazily so the voice catalog can be used without the native addon.
  load: async (options) => (await import('./engine.ts')).loadPocket(options),
};
