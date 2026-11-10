import type { ModelCatalog } from '../tts/modelCatalog.ts';
import type { Voice } from '../tts/types.ts';
import type { PreferenceDefaults, VoiceAccess } from './userPreferences.ts';

/** Curated voices need /unlock; a private upload is usable only by its owner. */
export function mayUseVoice(voice: Voice, access: VoiceAccess): boolean {
  if (voice.custom && !access.customVoices) return false;
  if (voice.uploaded && !voice.uploaded.published && voice.uploaded.ownerId !== access.userId) return false;
  return true;
}

/**
 * Preference defaults backed by the loaded models: stored choices for models
 * or voices that are gone (disabled model, deleted custom recording) fall back
 * to the defaults instead of failing.
 */
export function preferenceDefaultsFor(
  catalog: ModelCatalog,
  defaultVoice: string | undefined,
  customVoicesLocked = false,
): PreferenceDefaults {
  const modelDefaultVoice = (model: string): string => {
    const loaded = catalog.findModel(model);
    if (!loaded) return '';
    if (model === catalog.defaultModelId && defaultVoice && catalog.findVoice(model, defaultVoice)) return defaultVoice;
    return catalog.findVoice(model, loaded.defaultVoiceId) ? loaded.defaultVoiceId : loaded.voices[0]?.id ?? '';
  };
  return {
    announceName: true,
    customVoicesLocked,
    resolveModel: (requested) => (requested && catalog.findModel(requested) ? requested : catalog.defaultModelId),
    resolveVoice: (model, requested, access) => {
      const voice = requested ? catalog.findVoice(model, requested) : undefined;
      return voice && mayUseVoice(voice, access) ? voice.id : modelDefaultVoice(model);
    },
  };
}
