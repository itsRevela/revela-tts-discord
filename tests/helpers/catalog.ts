import { preferenceDefaultsFor } from '../../src/preferences/catalogDefaults.ts';
import type { PreferenceStore } from '../../src/preferences/preferenceStore.ts';
import {
  resolvePreferences,
  withPreference,
  type PreferencePatch,
  type StoredPreferences,
} from '../../src/preferences/userPreferences.ts';
import { createModelCatalog, type LoadedModel, type ModelCatalog } from '../../src/tts/modelCatalog.ts';
import { KOKORO_VOICES_BY_GRADE } from '../../src/tts/models/kokoro/voices.ts';
import { POCKET_VOICES } from '../../src/tts/models/pocket/voices.ts';
import type { TtsEngine, Voice } from '../../src/tts/types.ts';

export const CUSTOM_VOICES: readonly Voice[] = [
  { id: 'custom:rekp', label: 'rekp', custom: true },
  { id: 'custom:tony_balogna', label: 'Tony Balogna', custom: true },
];

export function loadedModel(
  id: string,
  name: string,
  voices: readonly Voice[],
  defaultVoiceId: string,
  engine?: TtsEngine,
): LoadedModel {
  return {
    id,
    name,
    description: `${name} for tests`,
    voices,
    defaultVoiceId,
    engine: engine ?? { voices, synthesize: async () => undefined },
  };
}

/** Pocket (with two custom voices) and Kokoro, Pocket being the default like production. */
export function testCatalog(defaultModelId = 'pocket'): ModelCatalog {
  return createModelCatalog(
    [
      loadedModel('pocket', 'Pocket TTS', [...POCKET_VOICES, ...CUSTOM_VOICES], 'alba'),
      loadedModel('kokoro', 'Kokoro', KOKORO_VOICES_BY_GRADE, 'af_heart'),
    ],
    defaultModelId,
  );
}

export type MemoryPreferences = PreferenceStore & { stored: () => StoredPreferences };

export function memoryPreferences(initial: StoredPreferences = {}, catalog: ModelCatalog = testCatalog()): MemoryPreferences {
  let state = initial;
  const defaults = preferenceDefaultsFor(catalog, undefined);
  return {
    stored: () => state,
    get: (userId) => resolvePreferences(state, userId, defaults),
    update: async (userId: string, patch: PreferencePatch) => {
      state = withPreference(state, userId, patch);
      return resolvePreferences(state, userId, defaults);
    },
  };
}
