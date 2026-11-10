import { parseUserVoiceKey } from '../../../userVoices/ids.ts';
import { loadSpeechServerModel } from '../../speechServer/engine.ts';
import type { ModelLoadOptions, TtsEngine } from '../../types.ts';
import { POCKET_SERVER } from './settings.ts';
import { DEFAULT_POCKET_VOICE_ID, pocketVoices } from './voices.ts';

/** Pocket runs in this repository's Python service (services/pocket), a separate container. */
export function loadPocket(options: ModelLoadOptions): Promise<TtsEngine> {
  return loadSpeechServerModel(
    {
      name: 'Pocket',
      settings: POCKET_SERVER,
      fallbackVoice: DEFAULT_POCKET_VOICE_ID,
      describeVoices: pocketVoices,
      // Uploaded voices ("user:<id>") are cloned by the server on demand, not listed by it.
      passThrough: (voiceId) => parseUserVoiceKey(voiceId) !== undefined,
    },
    options,
  );
}
