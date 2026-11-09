import { loadSpeechServerModel } from '../../speechServer/engine.ts';
import type { ModelLoadOptions, TtsEngine } from '../../types.ts';
import { PHONON_DEFAULT_VOICE, phononVoices } from './voices.ts';

/** Phonon runs in Gradium's ptts-openai-server, a second container. */
export function loadPhonon(options: ModelLoadOptions): Promise<TtsEngine> {
  return loadSpeechServerModel(
    {
      name: 'Phonon',
      settings: {
        urlVariable: 'PHONON_URL',
        timeoutVariable: 'PHONON_STARTUP_TIMEOUT_SECONDS',
        defaultUrl: 'http://phonon:8880',
        defaultTimeoutSeconds: 300,
      },
      fallbackVoice: PHONON_DEFAULT_VOICE,
      describeVoices: phononVoices,
    },
    options,
  );
}
