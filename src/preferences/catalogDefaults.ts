import type { ModelCatalog } from '../tts/modelCatalog.ts';
import type { PreferenceDefaults } from './userPreferences.ts';

/**
 * Preference defaults backed by the loaded models: stored choices for models
 * or voices that are gone (disabled model, deleted custom recording) fall back
 * to the defaults instead of failing.
 */
export function preferenceDefaultsFor(catalog: ModelCatalog, defaultVoice: string | undefined): PreferenceDefaults {
  const modelDefaultVoice = (model: string): string => {
    const loaded = catalog.findModel(model);
    if (!loaded) return '';
    if (model === catalog.defaultModelId && defaultVoice && catalog.findVoice(model, defaultVoice)) return defaultVoice;
    return catalog.findVoice(model, loaded.defaultVoiceId) ? loaded.defaultVoiceId : loaded.voices[0]?.id ?? '';
  };
  return {
    announceName: true,
    resolveModel: (requested) => (requested && catalog.findModel(requested) ? requested : catalog.defaultModelId),
    resolveVoice: (model, requested) =>
      requested && catalog.findVoice(model, requested) ? requested : modelDefaultVoice(model),
  };
}
