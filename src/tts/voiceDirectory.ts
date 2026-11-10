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

/** Every built-in voice; custom and uploaded voices have their own filters and are left out. */
export const ALL_VOICES: VoiceGroup = { id: 'all', label: 'All voices' };
export const CUSTOM_VOICES: VoiceGroup = { id: 'custom', label: 'Custom voices' };
/** The user's own uploads (/myvoices). */
export const MY_VOICES: VoiceGroup = { id: 'mine', label: 'My Voices' };
/** Uploads their authors published, newest first. */
export const COMMUNITY_VOICES: VoiceGroup = { id: 'community', label: 'Community Voices' };
const SEPARATE_GROUPS: ReadonlySet<string> = new Set([CUSTOM_VOICES.id, MY_VOICES.id, COMMUNITY_VOICES.id]);

export interface VoiceListOptions {
  /** Curated custom voices (they need /unlock when a password is set). Default true. */
  readonly includeCustom?: boolean;
  /** Whose uploads to list under My Voices; none without it. */
  readonly userId?: string;
  /** Published uploads under Community Voices. Default true. */
  readonly includeCommunity?: boolean;
}

/** Custom voices of these models are listed first, in this order; other models' follow in configured order. */
export const CUSTOM_VOICE_MODEL_ORDER: readonly string[] = ['pocket', 'neutts'];

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { en: 'English', zh: 'Mandarin Chinese' };

/** "kokoro:af_heart": unique across models, and what /voice stores in its choices. */
export function entryValue(entry: VoiceEntry): string {
  return `${entry.model.id}:${entry.voice.id}`;
}

function labelSuffix(voice: Voice): string {
  if (voice.custom) return ' (custom)';
  if (voice.uploaded?.published) return ` by ${voice.uploaded.authorUsername ?? 'someone'}`;
  if (voice.uploaded) return ' (private)';
  return '';
}

export function entryLabel(entry: VoiceEntry): string {
  return `${entry.voice.label}${labelSuffix(entry.voice)} · ${entry.model.name}`;
}

const isSeparate = (entry: VoiceEntry): boolean => SEPARATE_GROUPS.has(entry.group.id);

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

/** Uploaded voices: the user's own (oldest first) and the published ones (newest first). */
function uploadedEntries(catalog: ModelCatalog, userId: string | undefined, includeCommunity: boolean): readonly VoiceEntry[] {
  const uploaded = catalog.models.flatMap((model) =>
    model.voices.filter((voice) => voice.uploaded).map((voice) => ({ model, voice })),
  );
  const mine = userId
    ? uploaded.filter(({ voice }) => voice.uploaded?.ownerId === userId).map((entry) => ({ ...entry, group: MY_VOICES }))
    : [];
  const community = includeCommunity
    ? uploaded
        .filter(({ voice }) => voice.uploaded?.published)
        .sort((a, b) => (b.voice.uploaded?.publishedAt ?? '').localeCompare(a.voice.uploaded?.publishedAt ?? ''))
        .map((entry) => ({ ...entry, group: COMMUNITY_VOICES }))
    : [];
  return [...mine, ...community];
}

/**
 * Every voice of the loaded models, in display order: built-in voices first
 * (models in configured order, each model's languages in order of first
 * appearance, voices best first within each), then the custom voices
 * (models in CUSTOM_VOICE_MODEL_ORDER), then My Voices and Community Voices.
 */
export function voiceEntries(catalog: ModelCatalog, options: VoiceListOptions = {}): readonly VoiceEntry[] {
  const { includeCustom = true, userId, includeCommunity = true } = options;
  const builtIn = catalog.models.flatMap((model) => {
    const voices = model.voices.filter((voice) => !voice.custom && !voice.uploaded);
    const multilingual = new Set(voices.map((voice) => voice.language ?? '')).size > 1;
    const entries = voices.map((voice) => ({ model, voice, group: groupOf(model, voice, multilingual) }));
    const groupOrder = [...new Set(entries.map((entry) => entry.group.id))];
    return groupOrder.flatMap((groupId) => entries.filter((entry) => entry.group.id === groupId));
  });
  const customModels = [...catalog.models].sort((a, b) => customModelRank(a.id) - customModelRank(b.id));
  const custom = includeCustom
    ? customModels.flatMap((model) =>
        model.voices.filter((voice) => voice.custom).map((voice) => ({ model, voice, group: CUSTOM_VOICES })),
      )
    : [];
  return [...builtIn, ...custom, ...uploadedEntries(catalog, userId, includeCommunity)];
}

/** The picker's filters, "All voices" first. */
export function voiceGroups(entries: readonly VoiceEntry[]): readonly VoiceGroup[] {
  const groups = new Map(entries.map((entry) => [entry.group.id, entry.group]));
  return [ALL_VOICES, ...groups.values()];
}

export function entriesInGroup(entries: readonly VoiceEntry[], groupId: string): readonly VoiceEntry[] {
  if (groupId === ALL_VOICES.id) return entries.filter((entry) => !isSeparate(entry));
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
  if (!needle) return balanceGroups(entries.filter((entry) => !isSeparate(entry)), (entry) => entry.group.id, limit);
  return entries
    .filter((entry) => `${entry.voice.id} ${entryLabel(entry)} ${entry.group.label}`.toLowerCase().includes(needle))
    .slice(0, limit);
}
