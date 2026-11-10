import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logging/logger.ts';
import { serialize } from '../util/serialize.ts';
import { AUDIO_EXTENSIONS, EMPTY_CATALOG, type CatalogChange, type UserVoice, type UserVoiceCatalog } from './catalog.ts';
import { isUserVoiceId } from './ids.ts';

const SNOWFLAKE = /^\d{17,20}$/;

const voiceSchema = z.object({
  id: z.string().refine(isUserVoiceId),
  ownerId: z.string().regex(SNOWFLAKE),
  name: z.string().min(1).max(64),
  createdAt: z.string().min(1),
  source: z.object({
    ext: z.enum(AUDIO_EXTENSIONS),
    bytes: z.number().int().positive(),
    durationSec: z.number().positive(),
  }),
  published: z.object({ at: z.string().min(1), authorUsername: z.string().min(1).max(64) }).optional(),
});

const fileSchema = z.object({ version: z.literal(1), voices: z.record(z.string(), z.unknown()) });

/** Keeps every valid entry whose key matches its id; returns how many were dropped. */
export function parseCatalog(json: unknown): { readonly catalog: UserVoiceCatalog; readonly dropped: number } {
  const file = fileSchema.parse(json);
  const entries = Object.entries(file.voices);
  const valid = entries.flatMap(([key, value]) => {
    const voice = voiceSchema.safeParse(value);
    return voice.success && voice.data.id === key ? [[key, voice.data as UserVoice] as const] : [];
  });
  return { catalog: { version: 1, voices: Object.fromEntries(valid) }, dropped: entries.length - valid.length };
}

export interface CatalogStore {
  get(): UserVoiceCatalog;
  /** Applies a change; it is saved (and listeners told) only when it succeeds. Changes run one at a time. */
  apply(change: (catalog: UserVoiceCatalog) => CatalogChange): Promise<CatalogChange>;
  /** Called after every saved change. */
  subscribe(listener: (catalog: UserVoiceCatalog) => void): void;
}

async function readCatalog(filePath: string, logger: Logger): Promise<UserVoiceCatalog> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return EMPTY_CATALOG;
    throw error;
  }
  try {
    const { catalog, dropped } = parseCatalog(JSON.parse(raw));
    if (dropped > 0) logger.warn('Skipped invalid entries in the uploaded voice catalog', { filePath, dropped });
    return catalog;
  } catch (error: unknown) {
    // Keep the unreadable file for inspection instead of overwriting it.
    const backup = `${filePath}.corrupt-${Date.now()}`;
    await rename(filePath, backup);
    logger.error('Uploaded voice catalog was unreadable; starting empty', { filePath, backup, error });
    return EMPTY_CATALOG;
  }
}

async function writeCatalog(filePath: string, catalog: UserVoiceCatalog): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

export async function loadCatalogStore(filePath: string, logger: Logger): Promise<CatalogStore> {
  let catalog = await readCatalog(filePath, logger);
  let listeners: readonly ((catalog: UserVoiceCatalog) => void)[] = [];

  const apply = serialize(async (change: (current: UserVoiceCatalog) => CatalogChange): Promise<CatalogChange> => {
    const result = change(catalog);
    if (!result.ok) return result;
    await writeCatalog(filePath, result.catalog);
    catalog = result.catalog;
    for (const listener of listeners) {
      try {
        listener(catalog);
      } catch (error: unknown) {
        logger.warn('An uploaded voice catalog listener failed', { error });
      }
    }
    return result;
  });

  return {
    get: () => catalog,
    apply,
    subscribe: (listener) => {
      listeners = [...listeners, listener];
    },
  };
}
