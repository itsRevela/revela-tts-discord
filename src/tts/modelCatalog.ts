import type { TtsEngine, Voice } from './types.ts';

/** A model that loaded, with the voices it actually offers. */
export interface LoadedModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly voices: readonly Voice[];
  readonly defaultVoiceId: string;
  readonly engine: TtsEngine;
}

export interface VoiceMatch {
  readonly model: LoadedModel;
  readonly voice: Voice;
}

/** Runtime view of the loaded models, used by commands and preferences. */
export interface ModelCatalog {
  /** In configured order; grows as background models become ready. */
  readonly models: readonly LoadedModel[];
  /** Adds a model that finished loading later (replacing one with the same id). */
  add(model: LoadedModel): void;
  /** The configured default model, or the first loaded one while the default is still loading. */
  readonly defaultModelId: string;
  findModel(id: string): LoadedModel | undefined;
  findVoice(modelId: string, voiceId: string): Voice | undefined;
}

/** Discord autocomplete shows at most 25 choices. */
export const AUTOCOMPLETE_LIMIT = 25;

function matches(voice: Voice, needle: string): boolean {
  return !needle || `${voice.id} ${voice.label}`.toLowerCase().includes(needle);
}

/**
 * `order` lists model ids in display order (the configured TTS_MODELS); models
 * added later slot into their place in it.
 */
export function createModelCatalog(
  initial: readonly LoadedModel[],
  defaultModelId: string,
  order: readonly string[] = initial.map((model) => model.id),
): ModelCatalog {
  if (initial.length === 0) throw new Error('No TTS model loaded');
  const position = (id: string): number => (order.includes(id) ? order.indexOf(id) : order.length);
  let models: readonly LoadedModel[] = initial;
  const findModel = (id: string): LoadedModel | undefined => models.find((model) => model.id === id);

  return {
    get models() {
      return models;
    },
    add: (model) => {
      models = [...models.filter((existing) => existing.id !== model.id), model].sort((a, b) => position(a.id) - position(b.id));
    },
    get defaultModelId() {
      return findModel(defaultModelId) ? defaultModelId : (models[0]?.id ?? defaultModelId);
    },
    findModel,
    findVoice: (modelId, voiceId) => findModel(modelId)?.voices.find((voice) => voice.id === voiceId),
  };
}
