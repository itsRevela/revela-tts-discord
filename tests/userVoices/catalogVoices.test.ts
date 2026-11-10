import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mayUseVoice } from '../../src/preferences/catalogDefaults.ts';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import {
  ALL_VOICES,
  COMMUNITY_VOICES,
  MY_VOICES,
  entriesInGroup,
  entryLabel,
  entryValue,
  voiceEntries,
  voiceGroups,
} from '../../src/tts/voiceDirectory.ts';
import type { CatalogChange, UserVoice, UserVoiceCatalog } from '../../src/userVoices/catalog.ts';
import type { CatalogStore } from '../../src/userVoices/catalogStore.ts';
import { createUserVoiceSync, uploadedVoices, withUserVoices } from '../../src/userVoices/catalogVoices.ts';
import { loadedModel } from '../helpers/catalog.ts';

const ALEX = '300000000000000001';
const BOB = '300000000000000002';

function upload(id: string, ownerId: string, name: string, published?: { at: string; authorUsername: string }): UserVoice {
  return {
    id,
    ownerId,
    name,
    createdAt: `2026-11-10T00:00:0${id.charCodeAt(0) - 97}Z`,
    source: { ext: 'wav', bytes: 10, durationSec: 10 },
    ...(published ? { published } : {}),
  };
}

const CATALOG: UserVoiceCatalog = {
  version: 1,
  voices: {
    aaaaaaaaaaaaa: upload('aaaaaaaaaaaaa', ALEX, 'Alex Private'),
    bbbbbbbbbbbbb: upload('bbbbbbbbbbbbb', ALEX, 'Alex Shared', { at: '2026-11-10T01:00:00Z', authorUsername: 'alex_user' }),
    ccccccccccccc: upload('ccccccccccccc', BOB, 'Bob Private'),
    ddddddddddddd: upload('ddddddddddddd', BOB, 'Bob Shared', { at: '2026-11-10T02:00:00Z', authorUsername: 'bob_user' }),
  },
};

function fakeStore(initial: UserVoiceCatalog): CatalogStore & { set(catalog: UserVoiceCatalog): void } {
  let catalog = initial;
  let listeners: ((catalog: UserVoiceCatalog) => void)[] = [];
  return {
    get: () => catalog,
    apply: async (change: (current: UserVoiceCatalog) => CatalogChange) => change(catalog),
    subscribe: (listener) => {
      listeners = [...listeners, listener];
    },
    set: (next) => {
      catalog = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}

const pocket = () => loadedModel('pocket', 'Pocket TTS', [{ id: 'alba', label: 'Alba' }], 'alba');
const kokoro = () => loadedModel('kokoro', 'Kokoro', [{ id: 'af_heart', label: 'Heart' }], 'af_heart');

describe('uploaded voices in the Pocket model', () => {
  it('become Pocket voices with owner and publication, oldest first', () => {
    const voices = uploadedVoices(CATALOG);
    assert.deepEqual(voices.map((voice) => voice.id), [
      'user:aaaaaaaaaaaaa',
      'user:bbbbbbbbbbbbb',
      'user:ccccccccccccc',
      'user:ddddddddddddd',
    ]);
    assert.deepEqual(voices[1]?.uploaded, { ownerId: ALEX, published: true, authorUsername: 'alex_user', publishedAt: '2026-11-10T01:00:00Z' });
  });

  it('replace the previous uploads when recomposed', () => {
    const once = withUserVoices(pocket(), CATALOG);
    const twice = withUserVoices(once, { version: 1, voices: {} });
    assert.deepEqual(twice.voices.map((voice) => voice.id), ['alba']);
  });

  it('stay in sync with the catalog, whether Pocket loaded first or joins later', () => {
    const store = fakeStore(CATALOG);
    const early = createModelCatalog([kokoro(), pocket()], 'kokoro');
    createUserVoiceSync(early, store);
    assert.equal(early.findModel('pocket')?.voices.length, 5);

    const late = createModelCatalog([kokoro()], 'kokoro');
    const sync = createUserVoiceSync(late, store);
    late.add(sync.joined(pocket()));
    assert.equal(late.findModel('pocket')?.voices.length, 5);
    assert.equal(sync.joined(kokoro()).voices.length, 1, 'other models are untouched');
    store.set({ version: 1, voices: { aaaaaaaaaaaaa: CATALOG.voices['aaaaaaaaaaaaa']! } });
    assert.deepEqual(late.findModel('pocket')?.voices.map((voice) => voice.id), ['alba', 'user:aaaaaaaaaaaaa']);
  });
});

describe('My Voices and Community Voices', () => {
  const models = createModelCatalog([withUserVoices(pocket(), CATALOG), kokoro()], 'pocket');

  it('list the user\'s own uploads and every published one, newest first, outside All voices', () => {
    const entries = voiceEntries(models, { userId: ALEX });
    assert.deepEqual(entriesInGroup(entries, MY_VOICES.id).map(entryValue), ['pocket:user:aaaaaaaaaaaaa', 'pocket:user:bbbbbbbbbbbbb']);
    assert.deepEqual(entriesInGroup(entries, COMMUNITY_VOICES.id).map(entryValue), ['pocket:user:ddddddddddddd', 'pocket:user:bbbbbbbbbbbbb']);
    assert.ok(entriesInGroup(entries, ALL_VOICES.id).every((entry) => !entry.voice.uploaded));
    assert.deepEqual(voiceGroups(entries).slice(-2).map((group) => group.label), ['My Voices', 'Community Voices']);
  });

  it('never show someone else\'s private upload, and can leave out the community', () => {
    const entries = voiceEntries(models, { userId: BOB, includeCommunity: false });
    assert.deepEqual(entries.filter((entry) => entry.voice.uploaded).map(entryValue), ['pocket:user:ccccccccccccc', 'pocket:user:ddddddddddddd']);
  });

  it('label private uploads and credit authors of published ones', () => {
    const entries = voiceEntries(models, { userId: ALEX });
    const labels = new Map(entries.map((entry) => [entryValue(entry), entryLabel(entry)]));
    assert.equal(labels.get('pocket:user:aaaaaaaaaaaaa'), 'Alex Private (private) · Pocket TTS');
    assert.equal(labels.get('pocket:user:ddddddddddddd'), 'Bob Shared by bob_user · Pocket TTS');
  });
});

describe('mayUseVoice', () => {
  const voices = new Map(uploadedVoices(CATALOG).map((voice) => [voice.id, voice]));

  it('lets only the owner use a private upload, and anyone use a published one', () => {
    const bobPrivate = voices.get('user:ccccccccccccc')!;
    assert.equal(mayUseVoice(bobPrivate, { customVoices: true, userId: ALEX }), false);
    assert.equal(mayUseVoice(bobPrivate, { customVoices: false, userId: BOB }), true);
    assert.equal(mayUseVoice(voices.get('user:ddddddddddddd')!, { customVoices: false, userId: ALEX }), true);
  });

  it('still needs /unlock for curated custom voices', () => {
    const curated = { id: 'custom:rekp', label: 'rekp', custom: true };
    assert.equal(mayUseVoice(curated, { customVoices: false, userId: ALEX }), false);
    assert.equal(mayUseVoice(curated, { customVoices: true, userId: ALEX }), true);
  });
});
