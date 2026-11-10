import type { TtsModel } from '../../types.ts';
import { DEFAULT_POCKET_VOICE_ID } from './voices.ts';

export const pocketModel: TtsModel = {
  id: 'pocket',
  name: 'Pocket TTS',
  description: "Kyutai's voice-cloning model, run by Kyutai's own pocket-tts; 21 English voices",
  // The voice list comes from the server once it is reachable.
  voices: [],
  defaultVoiceId: DEFAULT_POCKET_VOICE_ID,
  remote: true,
  load: async (options) => (await import('./engine.ts')).loadPocket(options),
};
