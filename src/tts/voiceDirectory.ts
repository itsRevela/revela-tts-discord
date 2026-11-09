import type { LoadedModel, ModelCatalog } from './modelCatalog.ts';
import type { Voice } from './types.ts';

/** A voice together with the model that speaks it, as listed by /voice. */
export interface VoiceEntry {
  readonly model: LoadedModel;
  readonly voice: Voice;
  readonly group: VoiceGroup;
}

/** A filter in the /voice picker: one model, or one language of a multilingual model. */
export interface VoiceGroup {
  readonly id: string;
  readonly label: string;
}

/** Every built-in voice; custom voices have their own filter and are left out. */
export const ALL_VOICES: VoiceGroup = { id: 'all', label: 'All voices' };
export const CUSTOM_VOICES: VoiceGroup = { id: 'custom', label: 'Custom voices' };

/** Custom voices of these models are listed first, in this order; other models' follow in configured order. */
export const CUSTOM_VOICE_MODEL_ORDER: readonly string[] = ['neutts', 'pocket'];

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: 'English', zh: 'Mandarin Chinese' };

/** "kokoro:af_heart": unique across models, and what /voice stores in its choices. */
export function entryValue(entry: VoiceEntry): string {
  return `${entry.model.id}:${entry.voice.id}`;
}

export function entryLabel(entry: VoiceEntry): string {
  const custom = entry.voice.custom ? ' (custom)' : '';
  return `${entry.voice.label}${custom} · ${entry.model.name}`;
}

const isCustom = (entry: VoiceEntry): boolean => entry.group.id === CUSTOM_VOICES.id;

/** Groups split a model by language (when it has several) and by category, e.g. "Phonon Characters". */
function groupOf(model: LoadedModel, voice: Voice, multilingual: boolean): VoiceGroup {
  const language = voice.language ?? '';
  const languagePart = multilingual ? { id: `-${language}`, label: ` ${LANGUAGE_NAMES[language] ?? language}` } : { id: '', label: '' };
  const category = voice.category;
  const categoryPart = category ? { id: `-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: ` ${category}` } : { id: '', label: '' };
  return {
    id: `${model.id}${languagePart.id}${categoryPart.id}`,
    label: `${model.name}${languagePart.label}${categoryPart.label}`.trim(),
  };
}

function customModelRank(modelId: string): number {
  const index = CUSTOM_VOICE_MODEL_ORDER.indexOf(modelId);
  return index === -1 ? CUSTOM_VOICE_MODEL_ORDER.length : index;
}

/**
 * Every voice of the loaded models, in display order: built-in voices first
 * (models in configured order, each model's languages in order of first
 * appearance, voices best first within each), then the custom voices
 * (models in CUSTOM_VOICE_MODEL_ORDER).
 */
export function voiceEntries(catalog: ModelCatalog): readonly VoiceEntry[] {
  const builtIn = catalog.models.flatMap((model) => {
    const voices = model.voices.filter((voice) => !voice.custom);
    const multilingual = new Set(voices.map((voice) => voice.language ?? '')).size > 1;
    const entries = voices.map((voice) => ({ model, voice, group: groupOf(model, voice, multilingual) }));
    const groupOrder = [...new Set(entries.map((entry) => entry.group.id))];
    return groupOrder.flatMap((groupId) => entries.filter((entry) => entry.group.id === groupId));
  });
  const customModels = [...catalog.models].sort((a, b) => customModelRank(a.id) - customModelRank(b.id));
  const custom = customModels.flatMap((model) =>
    model.voices.filter((voice) => voice.custom).map((voice) => ({ model, voice, group: CUSTOM_VOICES })),
  );
  return [...builtIn, ...custom];
}

/** The picker's filters, "All voices" first. */
export function voiceGroups(entries: readonly VoiceEntry[]): readonly VoiceGroup[] {
  const groups = new Map(entries.map((entry) => [entry.group.id, entry.group]));
  return [ALL_VOICES, ...groups.values()];
}

export function entriesInGroup(entries: readonly VoiceEntry[], groupId: string): readonly VoiceEntry[] {
  if (groupId === ALL_VOICES.id) return entries.filter((entry) => !isCustom(entry));
  return entries.filter((entry) => entry.group.id === groupId);
}

/** Accepts "model:voice" (what autocomplete sends) or a bare voice id typed by hand, custom voices included. */
export function findEntry(entries: readonly VoiceEntry[], value: string): VoiceEntry | undefined {
  const exact = entries.find((entry) => entryValue(entry) === value);
  return exact ?? entries.find((entry) => entry.voice.id === value);
}

/**
 * Trims a list to `limit` while keeping every group visible: each smaller
 * group keeps up to an equal share of the slots and the largest fills the
 * rest with its first items. Order is preserved.
 */
export function balanceGroups<T>(items: readonly T[], keyOf: (item: T) => string, limit: number): readonly T[] {
  if (items.length <= limit) return items;
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  if (groups.size <= 1) return items.slice(0, limit);
  const [largest = [], ...others] = [...groups.values()].sort((a, b) => b.length - a.length);
  const share = Math.floor(limit / groups.size);
  const reserved = others.flatMap((group) => group.slice(0, share));
  const chosen = new Set([...largest.slice(0, limit - reserved.length), ...reserved]);
  return items.filter((item) => chosen.has(item));
}

/**
 * Autocomplete for /voice: typing matches name, accent, grade, model or
 * "custom" across every voice; with nothing typed it shows a mix of the
 * built-in groups (like "All voices", custom voices are left out).
 */
export function searchEntries(entries: readonly VoiceEntry[], query: string, limit: number): readonly VoiceEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return balanceGroups(entries.filter((entry) => !isCustom(entry)), (entry) => entry.group.id, limit);
  return entries
    .filter((entry) => `${entry.voice.id} ${entryLabel(entry)} ${entry.group.label}`.toLowerCase().includes(needle))
    .slice(0, limit);
}
