import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import {
  EMPTY_CATALOG,
  addVoice,
  deleteVoice,
  publishVoice,
  publishedVoices,
  renameVoice,
  unpublishVoice,
  voicesOf,
  type CatalogChange,
  type UserVoice,
  type UserVoiceCatalog,
} from '../../src/userVoices/catalog.ts';
import { loadCatalogStore, parseCatalog } from '../../src/userVoices/catalogStore.ts';

const ALEX = '300000000000000001';
const BOB = '300000000000000002';
const LIMITS = { maxPerUser: 2, maxTotal: 3 };

function voice(id: string, ownerId: string, name: string, createdAt = '2026-11-10T00:00:00Z'): UserVoice {
  return { id, ownerId, name, createdAt, source: { ext: 'ogg', bytes: 1000, durationSec: 12 } };
}

function unwrap(change: CatalogChange): UserVoiceCatalog {
  assert.ok(change.ok, change.ok ? '' : change.problem);
  return change.catalog;
}

function problem(change: CatalogChange): string {
  assert.ok(!change.ok, 'expected the change to be refused');
  return change.problem;
}

describe('catalog rules', () => {
  const one = unwrap(addVoice(EMPTY_CATALOG, voice('aaaaaaaaaaaaa', ALEX, 'Narrator'), LIMITS));

  it('adds voices, enforcing per-user and total limits and unique names per owner', () => {
    const two = unwrap(addVoice(one, voice('bbbbbbbbbbbbb', ALEX, 'Second', '2026-11-10T01:00:00Z'), LIMITS));
    assert.deepEqual(voicesOf(two, ALEX).map((entry) => entry.name), ['Narrator', 'Second']);
    assert.match(problem(addVoice(two, voice('ccccccccccccc', ALEX, 'Third'), LIMITS)), /already have 2 voices/);
    assert.match(problem(addVoice(one, voice('ccccccccccccc', ALEX, 'NARRATOR'), LIMITS)), /already have a voice named/);
    const full = unwrap(addVoice(two, voice('ccccccccccccc', BOB, 'Bob'), LIMITS));
    assert.match(problem(addVoice(full, voice('ddddddddddddd', BOB, 'More'), LIMITS)), /limit of uploaded voices/);
    assert.deepEqual(Object.keys(EMPTY_CATALOG.voices), [], 'nothing mutated');
  });

  it('publishes with the author username, keeping published names unique', () => {
    const published = unwrap(publishVoice(one, 'aaaaaaaaaaaaa', '2026-11-10T02:00:00Z', 'revela'));
    assert.deepEqual(published.voices['aaaaaaaaaaaaa']?.published, { at: '2026-11-10T02:00:00Z', authorUsername: 'revela' });
    const bobs = unwrap(addVoice(published, voice('bbbbbbbbbbbbb', BOB, 'narrator'), LIMITS));
    assert.match(problem(publishVoice(bobs, 'bbbbbbbbbbbbb', '2026-11-10T03:00:00Z', 'bob')), /already called narrator/);
    assert.deepEqual(publishedVoices(bobs).map((entry) => entry.id), ['aaaaaaaaaaaaa']);
  });

  it('renames the private and published copy together and refreshes the author', () => {
    const published = unwrap(publishVoice(one, 'aaaaaaaaaaaaa', '2026-11-10T02:00:00Z', 'old_name'));
    const renamed = unwrap(renameVoice(published, 'aaaaaaaaaaaaa', 'Storyteller', 'new_name'));
    assert.equal(renamed.voices['aaaaaaaaaaaaa']?.name, 'Storyteller');
    assert.equal(renamed.voices['aaaaaaaaaaaaa']?.published?.authorUsername, 'new_name');
    const withBob = unwrap(publishVoice(unwrap(addVoice(renamed, voice('bbbbbbbbbbbbb', BOB, 'Bob'), LIMITS)), 'bbbbbbbbbbbbb', 'x', 'bob'));
    assert.match(problem(renameVoice(withBob, 'bbbbbbbbbbbbb', 'storyteller', 'bob')), /community voice is already called/);
  });

  it('unpublishes and deletes, and refuses unknown voices', () => {
    const published = unwrap(publishVoice(one, 'aaaaaaaaaaaaa', 'x', 'revela'));
    assert.equal(unwrap(unpublishVoice(published, 'aaaaaaaaaaaaa')).voices['aaaaaaaaaaaaa']?.published, undefined);
    assert.deepEqual(unwrap(deleteVoice(published, 'aaaaaaaaaaaaa')).voices, {});
    assert.match(problem(deleteVoice(one, 'zzzzzzzzzzzzz')), /no longer exists/);
  });
});

describe('catalog file', () => {
  let directory = '';
  let filePath = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'user-voices-'));
    filePath = path.join(directory, 'catalog.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('keeps valid entries only', () => {
    const { catalog, dropped } = parseCatalog({
      version: 1,
      voices: {
        aaaaaaaaaaaaa: voice('aaaaaaaaaaaaa', ALEX, 'Good'),
        bbbbbbbbbbbbb: voice('ccccccccccccc', ALEX, 'Key does not match id'),
        ccccccccccccc: { ...voice('ccccccccccccc', ALEX, 'Bad'), source: { ext: 'exe', bytes: 1, durationSec: 1 } },
      },
    });
    assert.deepEqual(Object.keys(catalog.voices), ['aaaaaaaaaaaaa']);
    assert.equal(dropped, 2);
  });

  it('saves successful changes, tells listeners, and reloads them', async () => {
    const store = await loadCatalogStore(filePath, silentLogger);
    const seen: number[] = [];
    store.subscribe((catalog) => seen.push(Object.keys(catalog.voices).length));
    await store.apply((catalog) => addVoice(catalog, voice('aaaaaaaaaaaaa', ALEX, 'Narrator'), LIMITS));
    const refused = await store.apply((catalog) => addVoice(catalog, voice('bbbbbbbbbbbbb', ALEX, 'narrator'), LIMITS));
    assert.equal(refused.ok, false);
    assert.deepEqual(seen, [1], 'refused changes are not saved or announced');
    const reloaded = await loadCatalogStore(filePath, silentLogger);
    assert.equal(reloaded.get().voices['aaaaaaaaaaaaa']?.name, 'Narrator');
    assert.equal(JSON.parse(await readFile(filePath, 'utf8')).version, 1);
  });

  it('sets an unreadable file aside and starts empty', async () => {
    await writeFile(filePath, '{ not json', 'utf8');
    const store = await loadCatalogStore(filePath, silentLogger);
    assert.deepEqual(store.get().voices, {});
    assert.ok((await readdir(directory)).some((name) => name.startsWith('catalog.json.corrupt-')));
  });
});
