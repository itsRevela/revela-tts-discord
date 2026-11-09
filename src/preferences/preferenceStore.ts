import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logging/logger.ts';
import { serialize } from '../util/serialize.ts';
import {
  parseStoredPreferences,
  resolvePreferences,
  withPreference,
  type PreferenceDefaults,
  type PreferencePatch,
  type StoredPreferences,
  type UserPreferences,
} from './userPreferences.ts';

export interface PreferenceStore {
  get(userId: string): UserPreferences;
  update(userId: string, patch: PreferencePatch): Promise<UserPreferences>;
}

export interface PreferenceStoreOptions {
  readonly filePath: string;
  readonly defaults: PreferenceDefaults;
  readonly logger: Logger;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readStored(filePath: string, logger: Logger): Promise<StoredPreferences> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return {};
    throw error;
  }
  try {
    const { preferences, dropped } = parseStoredPreferences(JSON.parse(raw));
    if (dropped > 0) logger.warn('Skipped invalid entries in the preferences file', { filePath, dropped });
    return preferences;
  } catch (error: unknown) {
    // Keep the unreadable file for inspection instead of overwriting it.
    const backup = `${filePath}.corrupt-${Date.now()}`;
    await rename(filePath, backup);
    logger.error('Preferences file was unreadable; starting with defaults', { filePath, backup, error });
    return {};
  }
}

async function writeStored(filePath: string, preferences: StoredPreferences): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
  await rename(temporary, filePath);
}

/** Fails at startup, with the path in the message, if preferences could never be saved. */
async function ensureWritableDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.W_OK);
  } catch (error: unknown) {
    throw new Error(`Preferences directory ${directory} is not writable by this process`, { cause: error });
  }
}

/** JSON-file backed per-user preferences. Reads are served from memory. */
export async function loadPreferenceStore(options: PreferenceStoreOptions): Promise<PreferenceStore> {
  const { filePath, defaults, logger } = options;
  await ensureWritableDirectory(path.dirname(filePath));
  let state = await readStored(filePath, logger);
  const save = serialize((snapshot: StoredPreferences) => writeStored(filePath, snapshot));

  return {
    get: (userId) => resolvePreferences(state, userId, defaults),
    update: async (userId, patch) => {
      const previous = state;
      const next = withPreference(previous, userId, patch);
      state = next;
      try {
        await save(next);
      } catch (error: unknown) {
        if (state === next) state = previous;
        throw error;
      }
      return resolvePreferences(next, userId, defaults);
    },
  };
}
