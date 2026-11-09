import type { TtsModel } from '../../types.ts';
import { NEUTTS_DEFAULT_VOICE } from './voices.ts';

export const neuttsModel: TtsModel = {
  id: 'neutts',
  name: 'NeuTTS Air',
  description: "Neuphonic's voice-cloning model on a 0.5B language model; 6 English voices",
  // The voice list comes from the server once it is reachable.
  voices: [],
  defaultVoiceId: NEUTTS_DEFAULT_VOICE,
  remote: true,
  load: async (options) => (await import('./engine.ts')).loadNeutts(options),
};
