import { loadSpeechServerModel } from '../../speechServer/engine.ts';
import type { ModelLoadOptions, TtsEngine } from '../../types.ts';
import { DEFAULT_POCKET_VOICE_ID, pocketVoices } from './voices.ts';

/** Pocket runs in this repository's Python service (services/pocket), a separate container. */
export function loadPocket(options: ModelLoadOptions): Promise<TtsEngine> {
  return loadSpeechServerModel(
    {
      name: 'Pocket',
      settings: {
        urlVariable: 'POCKET_URL',
        timeoutVariable: 'POCKET_STARTUP_TIMEOUT_SECONDS',
        defaultUrl: 'http://pocket:8880',
        // The first start downloads the model and clones every custom voice.
        defaultTimeoutSeconds: 600,
      },
      fallbackVoice: DEFAULT_POCKET_VOICE_ID,
      describeVoices: pocketVoices,
    },
    options,
  );
}
