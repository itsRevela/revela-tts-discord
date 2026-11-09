import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_VOICES,
  balanceGroups,
  entriesInGroup,
  entryLabel,
  entryValue,
  findEntry,
  searchEntries,
  voiceEntries,
  voiceGroups,
} from '../../src/tts/voiceDirectory.ts';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { MODEL_IDS } from '../../src/tts/modelRegistry.ts';
import { KOKORO_VOICES_BY_GRADE } from '../../src/tts/models/kokoro/voices.ts';
import { phononVoices } from '../../src/tts/models/phonon/voices.ts';
import { POCKET_VOICES } from '../../src/tts/models/pocket/voices.ts';
import { CUSTOM_VOICES, loadedModel, testCatalog } from '../helpers/catalog.ts';

const entries = voiceEntries(testCatalog());

describe('voiceEntries', () => {
  it('lists every voice of every model, custom voices last', () => {
    assert.equal(entries.length, 21 + 36 + 2);
    assert.deepEqual(entries.slice(-2).map(entryValue), ['pocket:custom:rekp', 'pocket:custom:tony_balogna']);
    assert.ok(entries.slice(-2).every((entry) => entry.group.id === 'custom'));
  });

  it('lists NeuTTS custom voices first, then Pocket TTS, whatever the model order', () => {
    const catalog = createModelCatalog(
      [
        loadedModel('pocket', 'Pocket TTS', CUSTOM_VOICES, 'custom:rekp'),
        loadedModel('kokoro', 'Kokoro', [], 'af_heart'),
        loadedModel('neutts', 'NeuTTS Air', [{ id: 'jo', label: 'Jo' }, ...CUSTOM_VOICES], 'jo'),
      ],
      'pocket',
    );
    assert.deepEqual(entriesInGroup(voiceEntries(catalog), 'custom').map(entryValue), [
      'neutts:custom:rekp',
      'neutts:custom:tony_balogna',
      'pocket:custom:rekp',
      'pocket:custom:tony_balogna',
    ]);
  });

  it('orders the picker filters by the default model order, custom voices last', () => {
    const catalog = createModelCatalog(
      [
        loadedModel('pocket', 'Pocket TTS', [...POCKET_VOICES, ...CUSTOM_VOICES], 'alba'),
        loadedModel('kokoro', 'Kokoro', KOKORO_VOICES_BY_GRADE, 'af_heart'),
      ],
      'pocket',
      MODEL_IDS,
    );
    catalog.add(loadedModel('neutts', 'NeuTTS Air', [{ id: 'jo', label: 'Jo' }, ...CUSTOM_VOICES], 'jo'));
    catalog.add(loadedModel('phonon', 'Phonon', phononVoices({ voices: ['default', 'Harper', 'Grub the Ogre'], custom: [] }), 'Harper'));
    assert.deepEqual(voiceGroups(voiceEntries(catalog)).map((group) => group.label), [
      'All voices',
      'Phonon',
      'Phonon Characters',
      'NeuTTS Air',
      'Pocket TTS',
      'Kokoro English',
      'Kokoro Mandarin Chinese',
      'Custom voices',
    ]);
  });

  it('keeps model order, then language, then best first', () => {
    assert.equal(entryValue(entries[0]!), 'pocket:alba');
    assert.equal(entryValue(entries[21]!), 'kokoro:af_heart');
    assert.equal(entries[56]?.group.id, 'kokoro-zh');
    assert.equal(entries.at(-1)?.group.id, 'custom');
  });

  it('labels each voice with its model', () => {
    assert.equal(entryLabel(entries[21]!), 'Heart (American female) · grade A · Kokoro');
    assert.equal(entryLabel(entries.at(-1)!), 'Tony Balogna (custom) · Pocket TTS');
  });
});

describe('voiceGroups', () => {
  it('offers All, one filter per model (split by language where needed), then Custom', () => {
    assert.deepEqual(voiceGroups(entries).map((group) => `${group.id}=${group.label}`), [
      'all=All voices',
      'pocket=Pocket TTS',
      'kokoro-en=Kokoro English',
      'kokoro-zh=Kokoro Mandarin Chinese',
      'custom=Custom voices',
    ]);
    assert.equal(entriesInGroup(entries, 'kokoro-zh').length, 8);
    assert.equal(entriesInGroup(entries, 'custom').length, 2);
  });

  it('leaves custom voices out of All voices', () => {
    const all = entriesInGroup(entries, ALL_VOICES.id);
    assert.equal(all.length, 57);
    assert.ok(all.every((entry) => !entry.voice.custom));
  });
});

describe('findEntry', () => {
  it('accepts model-qualified values and bare voice ids', () => {
    assert.equal(findEntry(entries, 'kokoro:bm_george')?.model.id, 'kokoro');
    assert.equal(findEntry(entries, 'alba')?.model.id, 'pocket');
    assert.equal(findEntry(entries, 'custom:rekp')?.model.id, 'pocket');
    assert.equal(findEntry(entries, 'pocket:custom:tony_balogna')?.voice.label, 'Tony Balogna');
    assert.equal(findEntry(entries, 'pocket:af_heart'), undefined);
  });
});

describe('searchEntries', () => {
  it('shows a mix of every group when nothing is typed', () => {
    const shown = searchEntries(entries, '', 25);
    assert.equal(shown.length, 25);
    assert.deepEqual([...new Set(shown.map((entry) => entry.group.id))], ['pocket', 'kokoro-en', 'kokoro-zh']);
  });

  it('finds custom voices only when typed for', () => {
    assert.ok(searchEntries(entries, '', 25).every((entry) => !entry.voice.custom));
    assert.deepEqual(searchEntries(entries, 'rekp', 25).map(entryValue), ['pocket:custom:rekp']);
    assert.equal(searchEntries(entries, 'custom', 25).length, 2);
  });

  it('matches names, accents, grades and model names', () => {
    assert.equal(searchEntries(entries, 'chinese', 25).length, 8);
    assert.deepEqual(searchEntries(entries, 'heart', 25).map(entryValue), ['kokoro:af_heart']);
    assert.ok(searchEntries(entries, 'pocket tts', 25).every((entry) => entry.model.id === 'pocket'));
  });
});

describe('balanceGroups', () => {
  it('keeps every group visible and the order intact', () => {
    const items = [...Array.from({ length: 30 }, (_, i) => `a${i}`), 'b0', 'b1'];
    const shown = balanceGroups(items, (item) => item.charAt(0), 10);
    assert.deepEqual(shown, ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'b0', 'b1']);
  });

  it('leaves short or single-group lists alone', () => {
    assert.deepEqual(balanceGroups(['a', 'b'], () => 'x', 5), ['a', 'b']);
    assert.deepEqual(balanceGroups(['a', 'b', 'c'], () => 'x', 2), ['a', 'b']);
  });
});
