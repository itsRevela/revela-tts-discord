import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { UserVoiceSettings } from '../../src/config/config.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { createAttemptLimiter } from '../../src/unlock/attemptLimiter.ts';
import type { ClipCandidate } from '../../src/userVoices/attachment.ts';
import { createBlacklist } from '../../src/userVoices/blacklist.ts';
import { loadCatalogStore, type CatalogStore } from '../../src/userVoices/catalogStore.ts';
import { PocketVoiceError, type PocketVoiceClient } from '../../src/userVoices/pocketClient.ts';
import { createUserVoiceService, type UploadProgress, type UserVoiceService } from '../../src/userVoices/service.ts';
import { matchKey } from '../../src/userVoices/names.ts';

const ALEX = '300000000000000001';
const SETTINGS: UserVoiceSettings = { uploadsEnabled: true, maxPerUser: 2, maxTotal: 10, maxBytes: 1000, uploadsPerWindow: 10 };
const CLIP: ClipCandidate = { name: 'me.ogg', size: 100, contentType: 'audio/ogg', url: 'https://cdn/me.ogg' };

interface Harness {
  readonly service: UserVoiceService;
  readonly store: CatalogStore;
  readonly pocket: PocketVoiceClient & { forgotten: string[]; prepared: string[] };
  readonly directory: string;
}

let root = '';
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'user-voices-service-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function harness(overrides: { settings?: Partial<UserVoiceSettings>; head?: string; prepareError?: string; banned?: boolean } = {}): Promise<Harness> {
  const directory = path.join(root, 'user-voices');
  const store = await loadCatalogStore(path.join(directory, 'catalog.json'), silentLogger);
  const pocket = {
    prepared: [] as string[],
    forgotten: [] as string[],
    prepare: async (id: string) => {
      if (overrides.prepareError) throw new PocketVoiceError(overrides.prepareError, 'refused');
      pocket.prepared.push(id);
      return { durationSec: 12.5, truncated: false };
    },
    forget: async (id: string) => {
      pocket.forgotten.push(id);
    },
    speak: async () => Float32Array.from([0, 0.5, -0.5]),
  };
  let ids = 0;
  const service = createUserVoiceService({
    store,
    pocket,
    directory,
    settings: { ...SETTINGS, ...overrides.settings },
    blacklist: createBlacklist(['badword']),
    reservedNames: () => new Set([matchKey('Alba'), matchKey('rekp')]),
    isBanned: () => overrides.banned ?? false,
    logger: silentLogger,
    newId: () => `${'abcdefghijklm'[ids++]}aaaaaaaaaaaa`,
    download: async (_url, destination) => {
      await writeFile(destination, overrides.head ?? 'OggS....');
      return { bytes: 100, head: Uint8Array.from(Buffer.from(overrides.head ?? 'OggS....', 'latin1')) };
    },
  });
  return { service, store, pocket, directory };
}

const add = (h: Harness, name: string, onProgress?: (progress: UploadProgress) => void) =>
  h.service.add({ ownerId: ALEX, name, clip: CLIP }, onProgress);

describe('uploading a voice', () => {
  it('downloads, clones, saves and previews it, reporting each stage', async () => {
    const h = await harness();
    const stages: string[] = [];
    const result = await add(h, '  Grumpy  Narrator ', (progress) => stages.push(progress.stage));
    assert.ok(result.ok);
    assert.equal(result.value.voice.name, 'Grumpy Narrator');
    assert.equal(result.value.voice.source.durationSec, 12.5);
    assert.ok(result.value.preview && result.value.preview.toString('ascii', 0, 4) === 'RIFF');
    assert.deepEqual(stages, ['downloading', 'cloning', 'preview']);
    assert.ok(existsSync(path.join(h.directory, 'aaaaaaaaaaaaa', 'source.ogg')));
    assert.deepEqual(h.service.voicesOf(ALEX).map((voice) => voice.id), ['aaaaaaaaaaaaa']);
  });

  it('refuses a file whose contents are not the audio its name claims, leaving nothing behind', async () => {
    const h = await harness({ head: 'MZ\x90\0exe' });
    const result = await add(h, 'Sneaky');
    assert.ok(!result.ok && /isn't really OGG/.test(result.problem));
    assert.equal(existsSync(path.join(h.directory, 'aaaaaaaaaaaaa')), false);
    assert.deepEqual(h.pocket.prepared, []);
  });

  it('passes on Pocket\'s refusal and cleans up', async () => {
    const h = await harness({ prepareError: 'too_short' });
    const result = await add(h, 'Short');
    assert.ok(!result.ok && /too short/.test(result.problem));
    assert.equal(existsSync(path.join(h.directory, 'aaaaaaaaaaaaa')), false);
    assert.deepEqual(h.service.voicesOf(ALEX), []);
  });

  it('enforces the switch, bans, names, the per-user limit and duplicate names', async () => {
    assert.match(((await add(await harness({ settings: { uploadsEnabled: false } }), 'X Y')) as { problem: string }).problem, /switched off/);
    assert.match(((await add(await harness({ banned: true }), 'X Y')) as { problem: string }).problem, /not allowed/);
    const h = await harness();
    assert.match(((await add(h, '**')) as { problem: string }).problem, /2 to 32|Use only/);
    await add(h, 'One');
    assert.match(((await add(h, 'one')) as { problem: string }).problem, /already have a voice named/);
    await add(h, 'Two');
    assert.match(((await add(h, 'Three')) as { problem: string }).problem, /already have 2 voices/);
  });

  it('lets private names through the blacklist', async () => {
    const h = await harness();
    assert.ok((await add(h, 'badword private')).ok);
  });

  it('limits upload attempts per user', async () => {
    const h = await harness();
    const limited = createUserVoiceService({
      store: h.store,
      pocket: h.pocket,
      directory: h.directory,
      settings: SETTINGS,
      blacklist: createBlacklist([]),
      reservedNames: () => new Set(),
      logger: silentLogger,
      limiter: createAttemptLimiter({ maxFailures: 1, windowMs: 60_000, now: () => 0 }),
      download: async (_url, destination) => {
        await writeFile(destination, 'OggS');
        return { bytes: 4, head: Uint8Array.from(Buffer.from('OggS')) };
      },
    });
    assert.ok((await limited.add({ ownerId: ALEX, name: 'First', clip: CLIP })).ok);
    assert.match(((await limited.add({ ownerId: ALEX, name: 'Second', clip: CLIP })) as { problem: string }).problem, /Try again in/);
  });

  it('processes uploads one at a time and tells later uploaders their place', async () => {
    const h = await harness({ settings: { maxPerUser: 5 } });
    const waits: UploadProgress[] = [];
    const first = add(h, 'First');
    const second = add(h, 'Second', (progress) => {
      if (progress.stage === 'waiting') waits.push(progress);
    });
    assert.ok((await first).ok && (await second).ok);
    assert.deepEqual(waits, [{ stage: 'waiting', ahead: 1 }]);
  });
});

describe('managing voices', () => {
  it('publishes with the username, blocking blacklisted and reserved names', async () => {
    const h = await harness({ settings: { maxPerUser: 5 } });
    await add(h, 'Storyteller');
    await add(h, 'badword voice');
    await add(h, 'ALBA');
    const published = await h.service.publish(ALEX, 'storyteller', 'alex_user');
    assert.ok(published.ok && published.value.published?.authorUsername === 'alex_user');
    assert.match(((await h.service.publish(ALEX, 'badword voice', 'alex_user')) as { problem: string }).problem, /not allowed/);
    assert.match(((await h.service.publish(ALEX, 'Alba', 'alex_user')) as { problem: string }).problem, /bot's own voices/);
  });

  it('renames freely while private, but checks published names', async () => {
    const h = await harness();
    await add(h, 'Storyteller');
    assert.ok((await h.service.rename(ALEX, 'Storyteller', 'badword ok privately', 'alex_user')).ok);
    await h.service.rename(ALEX, 'badword ok privately', 'Teller', 'alex_user');
    await h.service.publish(ALEX, 'Teller', 'alex_user');
    assert.match(((await h.service.rename(ALEX, 'Teller', 'badword', 'alex_user')) as { problem: string }).problem, /not allowed/);
    const renamed = await h.service.rename(ALEX, 'Teller', 'Narrator', 'new_name');
    assert.ok(renamed.ok && renamed.value.name === 'Narrator' && renamed.value.published?.authorUsername === 'new_name');
  });

  it('unpublishes, and deletes everywhere including Pocket\'s clone and the files', async () => {
    const h = await harness();
    await add(h, 'Storyteller');
    await h.service.publish(ALEX, 'Storyteller', 'alex_user');
    assert.ok((await h.service.unpublish(ALEX, 'Storyteller')).ok);
    assert.match(((await h.service.unpublish(ALEX, 'Storyteller')) as { problem: string }).problem, /isn't published/);
    assert.ok((await h.service.remove(ALEX, 'aaaaaaaaaaaaa')).ok);
    assert.deepEqual(h.pocket.forgotten, ['aaaaaaaaaaaaa']);
    assert.equal(existsSync(path.join(h.directory, 'aaaaaaaaaaaaa')), false);
    assert.match(((await h.service.remove(ALEX, 'Storyteller')) as { problem: string }).problem, /don't have a voice/);
  });

  it('lets moderators delete anyone\'s voice by id', async () => {
    const h = await harness();
    await add(h, 'Storyteller');
    assert.ok((await h.service.remove('300000000000000009', 'aaaaaaaaaaaaa', true)).ok);
  });

  it('removes upload folders the catalog does not know', async () => {
    const h = await harness();
    await add(h, 'Kept');
    await mkdir(path.join(h.directory, 'zzzzzzzzzzzzz'), { recursive: true });
    assert.equal(await h.service.removeOrphans(), 1);
    assert.ok(existsSync(path.join(h.directory, 'aaaaaaaaaaaaa')));
    assert.equal(existsSync(path.join(h.directory, 'zzzzzzzzzzzzz')), false);
  });
});
