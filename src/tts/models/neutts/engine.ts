import { loadSpeechServerModel } from '../../speechServer/engine.ts';
import type { ModelLoadOptions, TtsEngine } from '../../types.ts';
import { NEUTTS_DEFAULT_VOICE, neuttsVoices } from './voices.ts';

/** NeuTTS runs in this repository's Python service (services/neutts), a separate container. */
export function loadNeutts(options: ModelLoadOptions): Promise<TtsEngine> {
  return loadSpeechServerModel(
    {
      name: 'NeuTTS',
      settings: {
        urlVariable: 'NEUTTS_URL',
        timeoutVariable: 'NEUTTS_STARTUP_TIMEOUT_SECONDS',
        defaultUrl: 'http://neutts:8880',
        defaultTimeoutSeconds: 300,
      },
      fallbackVoice: NEUTTS_DEFAULT_VOICE,
      describeVoices: neuttsVoices,
    },
    options,
  );
}
