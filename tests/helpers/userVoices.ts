import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { UserVoiceSettings } from '../../src/config/config.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { createBlacklist } from '../../src/userVoices/blacklist.ts';
import { EMPTY_CATALOG, type CatalogChange, type UserVoiceCatalog } from '../../src/userVoices/catalog.ts';
import type { CatalogStore } from '../../src/userVoices/catalogStore.ts';
import type { ModerationRecord, ModerationStore } from '../../src/userVoices/moderation.ts';
import type { PocketVoiceClient } from '../../src/userVoices/pocketClient.ts';
import { createUserVoiceService, type UserVoiceService } from '../../src/userVoices/service.ts';

/** Bans and reports kept in memory. */
export function memoryModeration(): ModerationStore {
  let record: ModerationRecord = { bans: {}, reports: [] };
  return {
    get: () => record,
    isBanned: (userId) => record.bans[userId] !== undefined,
    ban: async (userId, ban) => {
      record = { ...record, bans: { ...record.bans, [userId]: ban } };
    },
    unban: async (userId) => {
      if (!record.bans[userId]) return false;
      const { [userId]: _removed, ...bans } = record.bans;
      record = { ...record, bans };
      return true;
    },
    report: async (report) => {
      record = { ...record, reports: [...record.reports, report] };
    },
  };
}

/** A catalog store kept in memory, with the same contract as the file-backed one. */
export function memoryCatalogStore(initial: UserVoiceCatalog = EMPTY_CATALOG): CatalogStore {
  let catalog = initial;
  let listeners: readonly ((catalog: UserVoiceCatalog) => void)[] = [];
  return {
    get: () => catalog,
    apply: async (change: (current: UserVoiceCatalog) => CatalogChange) => {
      const result = change(catalog);
      if (result.ok) {
        catalog = result.catalog;
        listeners.forEach((listener) => listener(catalog));
      }
      return result;
    },
    subscribe: (listener) => {
      listeners = [...listeners, listener];
    },
  };
}

export const TEST_USER_VOICE_SETTINGS: UserVoiceSettings = {
  uploadsEnabled: true,
  maxPerUser: 5,
  maxTotal: 200,
  maxBytes: 10 * 1024 * 1024,
  uploadsPerWindow: 50,
};

export interface FakeUserVoices {
  readonly service: UserVoiceService;
  readonly store: CatalogStore;
}

/** A real upload service over memory, with a Pocket that always clones and a download that writes an Ogg header. */
export function fakeUserVoices(options: { store?: CatalogStore; settings?: Partial<UserVoiceSettings>; blocked?: readonly string[] } = {}): FakeUserVoices {
  const store = options.store ?? memoryCatalogStore();
  const pocket: PocketVoiceClient = {
    prepare: async () => ({ durationSec: 12, truncated: false }),
    forget: async () => undefined,
    speak: async () => Float32Array.from([0, 0.25, -0.25]),
  };
  let ids = 0;
  const service = createUserVoiceService({
    store,
    pocket,
    directory: path.join(os.tmpdir(), `tts-user-voices-${process.pid}`),
    settings: { ...TEST_USER_VOICE_SETTINGS, ...options.settings },
    blacklist: createBlacklist(options.blocked ?? []),
    reservedNames: () => new Set(),
    logger: silentLogger,
    newId: () => `${'abcdefghijklmnopqrstuvwxyz'[ids++ % 26]}${'a'.repeat(12)}`,
    download: async (_url, destination) => {
      await writeFile(destination, 'OggS');
      return { bytes: 4, head: Uint8Array.from(Buffer.from('OggS')) };
    },
  });
  return { service, store };
}
