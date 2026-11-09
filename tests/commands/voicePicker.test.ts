import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PICKER_PAGE_SIZE,
  initialPickerState,
  parsePickerCustomId,
  pickerCustomId,
  renderVoicePicker,
} from '../../src/commands/voicePicker.ts';
import { testCatalog } from '../helpers/catalog.ts';

type Row = { components: Record<string, unknown>[] };
type Option = { value: string; label: string; default?: boolean };

const catalog = testCatalog();
const rows = (view: { components: unknown[] }) => view.components as Row[];
const optionsOf = (view: { components: unknown[] }, row: number) => (rows(view)[row]?.components[0]?.['options'] ?? []) as Option[];
const button = (view: { components: unknown[] }, index: number) => rows(view)[2]?.components[index] as { disabled?: boolean; custom_id: string };

describe('picker custom ids', () => {
  it('round-trips the filter and page', () => {
    const id = pickerCustomId('next', { groupId: 'kokoro-en', page: 1 });
    assert.equal(id, 'voice:next:kokoro-en:1');
    assert.deepEqual(parsePickerCustomId(id), { action: 'next', state: { groupId: 'kokoro-en', page: 1 } });
  });

  it('rejects ids that are not the picker\'s', () => {
    assert.equal(parsePickerCustomId('voice:explode:all:0'), undefined);
    assert.equal(parsePickerCustomId('tts:next:all:0'), undefined);
  });
});

describe('renderVoicePicker', () => {
  it('pages through all 57 built-in voices 25 at a time', () => {
    const first = renderVoicePicker(catalog, { groupId: 'all', page: 0 }, 'pocket:alba');
    assert.equal(optionsOf(first, 1).length, PICKER_PAGE_SIZE);
    assert.equal(button(first, 0).disabled, true);
    assert.equal(button(first, 1).disabled, false);
    assert.match(first.content, /page 1 of 3/);

    const last = renderVoicePicker(catalog, { groupId: 'all', page: 2 }, 'pocket:alba');
    assert.equal(optionsOf(last, 1).length, 57 - 2 * PICKER_PAGE_SIZE);
    assert.equal(button(last, 1).disabled, true);
  });

  it('lists the filters with their counts and marks the active one', () => {
    const view = renderVoicePicker(catalog, { groupId: 'kokoro-zh', page: 0 }, 'pocket:alba');
    const filters = optionsOf(view, 0);
    assert.deepEqual(filters.map((option) => option.label), [
      'All voices (57)',
      'Pocket TTS (21)',
      'Kokoro English (28)',
      'Kokoro Mandarin Chinese (8)',
      'Custom voices (2)',
    ]);
    assert.equal(filters.find((option) => option.default)?.value, 'kokoro-zh');
    assert.equal(optionsOf(view, 1).length, 8);
  });

  it('marks the current voice and shows it in the text', () => {
    const view = renderVoicePicker(catalog, { groupId: 'kokoro-en', page: 0 }, 'kokoro:bm_george');
    assert.equal(optionsOf(view, 1).find((option) => option.default)?.value, 'kokoro:bm_george');
    assert.match(view.content, /Your voice: \*\*George \(British male\) · grade C · Kokoro\*\*/);
  });

  it('clamps out-of-range pages and unknown filters', () => {
    const view = renderVoicePicker(catalog, { groupId: 'retired', page: 99 }, 'pocket:alba');
    assert.match(view.content, /All voices, page 3 of 3/);
  });

  it('opens on the filter and page holding the current voice', () => {
    assert.deepEqual(initialPickerState(catalog, 'kokoro:zm_yunyang'), { groupId: 'kokoro-zh', page: 0 });
    assert.deepEqual(initialPickerState(catalog, 'pocket:custom:rekp'), { groupId: 'custom', page: 0 });
    assert.deepEqual(initialPickerState(catalog, 'pocket:retired'), { groupId: 'all', page: 0 });
  });

  it('lists the custom voices in their own filter', () => {
    const view = renderVoicePicker(catalog, { groupId: 'custom', page: 0 }, 'pocket:custom:rekp');
    assert.deepEqual(optionsOf(view, 1).map((option) => option.value), ['pocket:custom:rekp', 'pocket:custom:tony_balogna']);
    assert.match(view.content, /Your voice: \*\*rekp \(custom\) · Pocket TTS\*\*/);
  });
});
