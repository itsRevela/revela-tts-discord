/**
 * Puts uploaded voices into the Pocket model's voice list, so /voice, /search,
 * preferences and synthesis treat them like any other Pocket voice. The list is
 * recomposed whenever Pocket (re)joins or the uploaded voice catalog changes.
 */
import type { LoadedModel, ModelCatalog } from '../tts/modelCatalog.ts';
import type { Voice } from '../tts/types.ts';
import type { UserVoiceCatalog } from './catalog.ts';
import type { CatalogStore } from './catalogStore.ts';
import { userVoiceKey } from './ids.ts';

/** Uploaded voices are cloned by Pocket only. */
export const UPLOADED_VOICE_MODEL = 'pocket';

export function uploadedVoices(catalog: UserVoiceCatalog): readonly Voice[] {
  return Object.values(catalog.voices)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((voice) => ({
      id: userVoiceKey(voice.id),
      label: voice.name,
      language: 'en',
      uploaded: {
        ownerId: voice.ownerId,
        published: voice.published !== undefined,
        ...(voice.published ? { authorUsername: voice.published.authorUsername, publishedAt: voice.published.at } : {}),
      },
    }));
}

/** The Pocket model with the current uploaded voices after its own. */
export function withUserVoices(base: LoadedModel, catalog: UserVoiceCatalog): LoadedModel {
  return { ...base, voices: [...base.voices.filter((voice) => !voice.uploaded), ...uploadedVoices(catalog)] };
}

export interface UserVoiceSync {
  /** Wraps a model joining the catalog; Pocket gets the uploaded voices. */
  joined(model: LoadedModel): LoadedModel;
}

/** Keeps the Pocket entry of the model catalog in step with the uploaded voice catalog. */
export function createUserVoiceSync(models: ModelCatalog, store: CatalogStore): UserVoiceSync {
  let base: LoadedModel | undefined = models.findModel(UPLOADED_VOICE_MODEL);
  if (base) models.add(withUserVoices(base, store.get()));
  store.subscribe((catalog) => {
    if (base) models.add(withUserVoices(base, catalog));
  });
  return {
    joined: (model) => {
      if (model.id !== UPLOADED_VOICE_MODEL) return model;
      base = model;
      return withUserVoices(model, store.get());
    },
  };
}
