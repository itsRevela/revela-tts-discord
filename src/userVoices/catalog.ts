/**
 * The catalog of uploaded voices and the rules for changing it, as pure
 * functions: each returns a new catalog or the reason the change is refused.
 * The bot owns this catalog; the Pocket server only clones the clips.
 */
import { matchKey } from './names.ts';

export const AUDIO_EXTENSIONS = ['wav', 'flac', 'ogg', 'mp3'] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export interface UserVoiceSource {
  readonly ext: AudioExtension;
  readonly bytes: number;
  readonly durationSec: number;
}

export interface UserVoicePublication {
  readonly at: string;
  /** The author's Discord username (never their display name), refreshed on rename and republish. */
  readonly authorUsername: string;
}

export interface UserVoice {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly source: UserVoiceSource;
  readonly published?: UserVoicePublication;
}

export interface UserVoiceCatalog {
  readonly version: 1;
  readonly voices: Readonly<Record<string, UserVoice>>;
}

export const EMPTY_CATALOG: UserVoiceCatalog = Object.freeze({ version: 1, voices: Object.freeze({}) });

export interface CatalogLimits {
  readonly maxPerUser: number;
  readonly maxTotal: number;
}

export type CatalogChange =
  | { readonly ok: true; readonly catalog: UserVoiceCatalog; readonly voice: UserVoice }
  | { readonly ok: false; readonly problem: string };

const refuse = (problem: string): CatalogChange => ({ ok: false, problem });

const withVoice = (catalog: UserVoiceCatalog, voice: UserVoice): CatalogChange => ({
  ok: true,
  catalog: { ...catalog, voices: { ...catalog.voices, [voice.id]: voice } },
  voice,
});

/** A user's own voices, oldest first. */
export function voicesOf(catalog: UserVoiceCatalog, ownerId: string): readonly UserVoice[] {
  return Object.values(catalog.voices)
    .filter((voice) => voice.ownerId === ownerId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Community voices, newest first. */
export function publishedVoices(catalog: UserVoiceCatalog): readonly UserVoice[] {
  return Object.values(catalog.voices)
    .filter((voice) => voice.published !== undefined)
    .sort((a, b) => (b.published?.at ?? '').localeCompare(a.published?.at ?? ''));
}

const ownerHasName = (catalog: UserVoiceCatalog, ownerId: string, name: string, exceptId?: string): boolean =>
  voicesOf(catalog, ownerId).some((voice) => voice.id !== exceptId && matchKey(voice.name) === matchKey(name));

const publishedHasName = (catalog: UserVoiceCatalog, name: string, exceptId: string): boolean =>
  publishedVoices(catalog).some((voice) => voice.id !== exceptId && matchKey(voice.name) === matchKey(name));

export function addVoice(catalog: UserVoiceCatalog, voice: UserVoice, limits: CatalogLimits): CatalogChange {
  if (voicesOf(catalog, voice.ownerId).length >= limits.maxPerUser) {
    return refuse(`You already have ${limits.maxPerUser} voices. Delete one with /myvoices delete first.`);
  }
  if (Object.keys(catalog.voices).length >= limits.maxTotal) return refuse('The bot has reached its limit of uploaded voices.');
  if (ownerHasName(catalog, voice.ownerId, voice.name)) return refuse(`You already have a voice named ${voice.name}.`);
  return withVoice(catalog, voice);
}

/** Renames both the private voice and its published copy; a published name must stay unique in the community. */
export function renameVoice(catalog: UserVoiceCatalog, id: string, name: string, authorUsername: string): CatalogChange {
  const voice = catalog.voices[id];
  if (!voice) return refuse('That voice no longer exists.');
  if (ownerHasName(catalog, voice.ownerId, name, id)) return refuse(`You already have a voice named ${name}.`);
  if (voice.published && publishedHasName(catalog, name, id)) {
    return refuse(`A community voice is already called ${name}. Pick another name.`);
  }
  const published = voice.published ? { ...voice.published, authorUsername } : undefined;
  return withVoice(catalog, { ...voice, name, ...(published ? { published } : {}) });
}

export function publishVoice(catalog: UserVoiceCatalog, id: string, at: string, authorUsername: string): CatalogChange {
  const voice = catalog.voices[id];
  if (!voice) return refuse('That voice no longer exists.');
  if (publishedHasName(catalog, voice.name, id)) {
    return refuse(`A community voice is already called ${voice.name}. Rename yours with /myvoices rename first.`);
  }
  return withVoice(catalog, { ...voice, published: { at: voice.published?.at ?? at, authorUsername } });
}

export function unpublishVoice(catalog: UserVoiceCatalog, id: string): CatalogChange {
  const voice = catalog.voices[id];
  if (!voice) return refuse('That voice no longer exists.');
  const { published: _published, ...rest } = voice;
  return withVoice(catalog, rest);
}

/** Removes the voice everywhere (private and published). */
export function deleteVoice(catalog: UserVoiceCatalog, id: string): CatalogChange {
  const voice = catalog.voices[id];
  if (!voice) return refuse('That voice no longer exists.');
  const { [id]: _removed, ...voices } = catalog.voices;
  return { ok: true, catalog: { ...catalog, voices }, voice };
}
