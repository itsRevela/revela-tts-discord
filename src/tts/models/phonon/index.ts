import type { TtsModel } from '../../types.ts';
import { PHONON_STARTING_VOICE } from './voices.ts';

export const phononModel: TtsModel = {
  id: 'phonon',
  name: 'Phonon',
  description: "Gradium's streaming model, the fastest here; 25 English voices plus 12 characters",
  // The voice list comes from the server once it is reachable.
  voices: [],
  defaultVoiceId: PHONON_STARTING_VOICE,
  remote: true,
  load: async (options) => (await import('./engine.ts')).loadPhonon(options),
};
