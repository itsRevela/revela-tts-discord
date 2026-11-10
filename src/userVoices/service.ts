import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { encodeWav16 } from '../audio/wav.ts';
import type { UserVoiceSettings } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import { createAttemptLimiter, type AttemptLimiter } from '../unlock/attemptLimiter.ts';
import { checkClip, sniffFormat, type ClipCandidate } from './attachment.ts';
import type { Blacklist } from './blacklist.ts';
import {
  addVoice,
  deleteVoice,
  publishVoice,
  publishedVoices,
  renameVoice,
  unpublishVoice,
  voicesOf,
  type CatalogChange,
  type UserVoice,
} from './catalog.ts';
import type { CatalogStore } from './catalogStore.ts';
import { downloadClip, ClipDownloadError } from './download.ts';
import { isUserVoiceId, newUserVoiceId } from './ids.ts';
import { checkVoiceName, matchKey } from './names.ts';
import { problemFor, type PocketVoiceClient } from './pocketClient.ts';

/** Every upload attempt counts towards this window, successful or not. */
export const UPLOAD_WINDOW_MS = 10 * 60_000;
const POCKET_SAMPLE_RATE = 24_000;

export type UploadStage = 'waiting' | 'downloading' | 'cloning' | 'preview';
export interface UploadProgress {
  readonly stage: UploadStage;
  /** Uploads ahead of this one, while waiting. */
  readonly ahead?: number;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

export interface UploadedVoice {
  readonly voice: UserVoice;
  /** A short sample of the new voice as WAV, if it could be made. */
  readonly preview: Buffer | undefined;
  readonly truncated: boolean;
}

export interface UserVoiceServiceOptions {
  readonly store: CatalogStore;
  readonly pocket: PocketVoiceClient;
  /** data/user-voices: one folder per voice id. */
  readonly directory: string;
  readonly settings: UserVoiceSettings;
  readonly blacklist: Blacklist;
  /** Match keys of built-in and curated voice names, which community voices may not reuse. */
  readonly reservedNames: () => ReadonlySet<string>;
  readonly isBanned?: (userId: string) => boolean;
  readonly logger: Logger;
  readonly limiter?: AttemptLimiter;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly download?: typeof downloadClip;
}

export interface UserVoiceService {
  add(request: { readonly ownerId: string; readonly name: string; readonly clip: ClipCandidate }, onProgress?: (progress: UploadProgress) => void): Promise<Outcome<UploadedVoice>>;
  rename(ownerId: string, voice: string, newName: string, username: string): Promise<Outcome<UserVoice>>;
  publish(ownerId: string, voice: string, username: string): Promise<Outcome<UserVoice>>;
  unpublish(ownerId: string, voice: string): Promise<Outcome<UserVoice>>;
  /** Deletes the voice everywhere; moderators may delete anyone's. */
  remove(actorId: string, voice: string, asModerator?: boolean): Promise<Outcome<UserVoice>>;
  voicesOf(ownerId: string): readonly UserVoice[];
  /** Every uploaded voice, for moderators. */
  allVoices(): readonly UserVoice[];
  /** Community voices, newest first. */
  publishedVoices(): readonly UserVoice[];
  /** A user's voice by id or by name. */
  findOwned(ownerId: string, voice: string): UserVoice | undefined;
  /** Removes upload folders the catalog doesn't know (left by a crash mid-upload). */
  removeOrphans(): Promise<number>;
}

const fail = <T>(problem: string): Outcome<T> => ({ ok: false, problem });
const fromChange = (change: CatalogChange): Outcome<UserVoice> => (change.ok ? { ok: true, value: change.voice } : fail(change.problem));

export const previewText = (name: string): string => `Hi! I'm ${name}. This is how your new voice sounds.`;

export function createUserVoiceService(options: UserVoiceServiceOptions): UserVoiceService {
  const { store, pocket, directory, settings, blacklist, logger } = options;
  const limiter = options.limiter ?? createAttemptLimiter({ maxFailures: settings.uploadsPerWindow, windowMs: UPLOAD_WINDOW_MS });
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? newUserVoiceId;
  const download = options.download ?? downloadClip;
  const isBanned = options.isBanned ?? (() => false);
  const limits = { maxPerUser: settings.maxPerUser, maxTotal: settings.maxTotal };
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;

  const findOwned = (ownerId: string, voice: string): UserVoice | undefined =>
    voicesOf(store.get(), ownerId).find((entry) => entry.id === voice || matchKey(entry.name) === matchKey(voice));

  /** Published names must pass the blacklist and must not copy a built-in or curated voice. */
  const publishableName = (name: string): string | undefined => {
    if (blacklist.blocks(name)) return 'That name is not allowed for community voices. Pick another one.';
    if (options.reservedNames().has(matchKey(name))) return 'That name belongs to one of the bot\'s own voices. Pick another one.';
    return undefined;
  };

  async function process(ownerId: string, name: string, clip: ClipCandidate, ext: UserVoice['source']['ext'], report: (progress: UploadProgress) => void): Promise<Outcome<UploadedVoice>> {
    const id = newId();
    const folder = path.join(directory, id);
    const cleanUp = async (): Promise<void> => {
      await rm(folder, { recursive: true, force: true });
    };
    try {
      report({ stage: 'downloading' });
      await mkdir(folder, { recursive: true });
      const { bytes, head } = await download(clip.url, path.join(folder, `source.${ext}`), settings.maxBytes);
      if (sniffFormat(head) !== ext) {
        await cleanUp();
        return fail(`That file isn't really ${ext.toUpperCase()} audio. Export it again and upload that.`);
      }
      report({ stage: 'cloning' });
      const prepared = await pocket.prepare(id);
      const voice: UserVoice = { id, ownerId, name, createdAt: now().toISOString(), source: { ext, bytes, durationSec: prepared.durationSec } };
      const added = await store.apply((catalog) => addVoice(catalog, voice, limits));
      if (!added.ok) {
        await cleanUp();
        await pocket.forget(id).catch(() => undefined);
        return fail(added.problem);
      }
      report({ stage: 'preview' });
      const preview = await pocket
        .speak(id, previewText(name))
        .then((samples) => (samples.length > 0 ? encodeWav16(samples, POCKET_SAMPLE_RATE) : undefined))
        .catch((error: unknown) => {
          logger.warn('Could not make a preview of an uploaded voice', { error, voiceId: id });
          return undefined;
        });
      logger.info('Uploaded voice added', { voiceId: id, ownerId, seconds: prepared.durationSec });
      return { ok: true, value: { voice: added.voice, preview, truncated: prepared.truncated } };
    } catch (error: unknown) {
      await cleanUp();
      if (error instanceof ClipDownloadError) return fail(error.message);
      logger.warn('An upload failed', { error, ownerId });
      return fail(problemFor(error));
    }
  }

  return {
    findOwned,
    voicesOf: (ownerId) => voicesOf(store.get(), ownerId),
    allVoices: () => Object.values(store.get().voices).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    publishedVoices: () => publishedVoices(store.get()),

    add: async ({ ownerId, name: rawName, clip }, onProgress) => {
      const report = (progress: UploadProgress): void => onProgress?.(progress);
      if (!settings.uploadsEnabled) return fail('Voice uploads are switched off right now.');
      if (isBanned(ownerId)) return fail('You are not allowed to upload voices.');
      const name = checkVoiceName(rawName);
      if (!name.ok) return fail(name.problem);
      if (voicesOf(store.get(), ownerId).length >= settings.maxPerUser) {
        return fail(`You already have ${settings.maxPerUser} voices. Delete one with /myvoices delete first.`);
      }
      if (findOwned(ownerId, name.name)) return fail(`You already have a voice named ${name.name}.`);
      const wait = limiter.waitMs(ownerId);
      if (wait > 0) return fail(`You've uploaded a lot recently. Try again in ${Math.max(Math.ceil(wait / 60_000), 1)} minutes.`);
      const clipCheck = checkClip(clip, settings.maxBytes);
      if (!clipCheck.ok) return fail(clipCheck.problem);
      limiter.fail(ownerId);

      const ahead = pending;
      pending += 1;
      if (ahead > 0) report({ stage: 'waiting', ahead });
      const job = queue.then(() => process(ownerId, name.name, clip, clipCheck.ext, report));
      queue = job.catch(() => undefined);
      try {
        return await job;
      } finally {
        pending -= 1;
      }
    },

    rename: async (ownerId, voice, rawName, username) => {
      const existing = findOwned(ownerId, voice);
      if (!existing) return fail("You don't have a voice by that name.");
      const name = checkVoiceName(rawName);
      if (!name.ok) return fail(name.problem);
      if (existing.published) {
        const problem = publishableName(name.name);
        if (problem) return fail(problem);
      }
      return fromChange(await store.apply((catalog) => renameVoice(catalog, existing.id, name.name, username)));
    },

    publish: async (ownerId, voice, username) => {
      const existing = findOwned(ownerId, voice);
      if (!existing) return fail("You don't have a voice by that name.");
      if (!settings.uploadsEnabled) return fail('Publishing voices is switched off right now.');
      if (isBanned(ownerId)) return fail('You are not allowed to publish voices.');
      const problem = publishableName(existing.name);
      if (problem) return fail(problem);
      return fromChange(await store.apply((catalog) => publishVoice(catalog, existing.id, now().toISOString(), username)));
    },

    unpublish: async (ownerId, voice) => {
      const existing = findOwned(ownerId, voice);
      if (!existing) return fail("You don't have a voice by that name.");
      if (!existing.published) return fail(`${existing.name} isn't published.`);
      return fromChange(await store.apply((catalog) => unpublishVoice(catalog, existing.id)));
    },

    remove: async (actorId, voice, asModerator = false) => {
      const existing = asModerator && isUserVoiceId(voice) ? store.get().voices[voice] : findOwned(actorId, voice);
      if (!existing) return fail(asModerator ? 'No uploaded voice has that id.' : "You don't have a voice by that name.");
      const removed = fromChange(await store.apply((catalog) => deleteVoice(catalog, existing.id)));
      if (!removed.ok) return removed;
      await pocket.forget(existing.id).catch((error: unknown) => {
        logger.warn('Pocket could not forget a deleted voice; its cache is swept on restart', { error, voiceId: existing.id });
      });
      await rm(path.join(directory, existing.id), { recursive: true, force: true });
      logger.info('Uploaded voice deleted', { voiceId: existing.id, byModerator: asModerator });
      return removed;
    },

    removeOrphans: async () => {
      const known = store.get().voices;
      const folders = await readdir(directory).catch(() => [] as string[]);
      const orphans = folders.filter((folder) => isUserVoiceId(folder) && !known[folder]);
      await Promise.all(orphans.map((folder) => rm(path.join(directory, folder), { recursive: true, force: true })));
      return orphans.length;
    },
  };
}
