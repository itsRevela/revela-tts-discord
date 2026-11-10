import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customVoiceCommand, findCustomEntry } from '../../src/commands/customVoice.ts';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { KOKORO_VOICES_BY_GRADE } from '../../src/tts/models/kokoro/voices.ts';
import { POCKET_VOICES } from '../../src/tts/models/pocket/voices.ts';
import { CUSTOM_VOICES as CUSTOM_GROUP, entriesInGroup, entryValue, voiceEntries } from '../../src/tts/voiceDirectory.ts';
import { CUSTOM_VOICES, loadedModel } from '../helpers/catalog.ts';
import { searchCommand } from '../../src/commands/search.ts';
import { voiceCommand } from '../../src/commands/voice.ts';
import {
  USER_ID,
  commandContext,
  contentOf,
  fakeAutocomplete,
  fakeComponent,
  fakeInteraction,
  isEphemeral,
  memoryPreferences,
} from '../helpers/fakes.ts';

type Choice = { name: string; value: string };
type View = { content: string; components: { components: { options?: { value: string; default?: boolean }[] }[] }[] };

const onKokoro = () => memoryPreferences({ [USER_ID]: { model: 'kokoro' } });

describe('/voice', () => {
  it('opens the private picker on the current voice when no name is given', async () => {
    const interaction = fakeInteraction({ commandName: 'voice' });
    await voiceCommand.execute(interaction, commandContext());
    const reply = interaction.replies[0];
    assert.equal(isEphemeral(reply), true);
    assert.match(contentOf(reply), /Your voice: \*\*Alba \(Kyutai's default\) · Pocket TTS\*\*/);
    const view = reply?.payload as View;
    assert.equal(view.components.length, 3);
  });

  it('no longer takes a typed name (that is /search)', () => {
    assert.equal(voiceCommand.data.options?.length ?? 0, 0);
    assert.equal(voiceCommand.autocomplete, undefined);
  });
});

describe('/search', () => {
  it('switches model when a voice from another model is chosen', async () => {
    const preferences = memoryPreferences();
    const interaction = fakeInteraction({ commandName: 'search', strings: { query: 'kokoro:bm_george' } });
    await searchCommand.execute(interaction, commandContext({ preferences }));
    assert.deepEqual(preferences.get(USER_ID), { model: 'kokoro', voice: 'bm_george', announceName: true, customVoices: true });
    assert.equal(contentOf(interaction.replies[0]), 'Your /tts messages will now use George (British male) · grade C · Kokoro.');
  });

  it('accepts a bare voice id typed by hand', async () => {
    const preferences = onKokoro();
    await searchCommand.execute(fakeInteraction({ commandName: 'search', strings: { query: 'marius' } }), commandContext({ preferences }));
    assert.deepEqual(preferences.get(USER_ID), { model: 'pocket', voice: 'marius', announceName: true, customVoices: true });
  });

  it('accepts custom voices too and rejects unknown names', async () => {
    const custom = memoryPreferences();
    const pick = fakeInteraction({ commandName: 'search', strings: { query: 'pocket:custom:rekp' } });
    await searchCommand.execute(pick, commandContext({ preferences: custom }));
    assert.deepEqual(custom.get(USER_ID), { model: 'pocket', voice: 'custom:rekp', announceName: true, customVoices: true });
    assert.equal(contentOf(pick.replies[0]), 'Your /tts messages will now use rekp (custom) · Pocket TTS.');

    const preferences = memoryPreferences();
    const unknown = fakeInteraction({ commandName: 'search', strings: { query: 'robot' } });
    await searchCommand.execute(unknown, commandContext({ preferences }));
    assert.match(contentOf(unknown.replies[0]), /isn't one of the voices/);
    assert.deepEqual(preferences.stored(), {});
  });

  it('autocompletes across every model with model-qualified values', async () => {
    const interaction = fakeAutocomplete('search', 'brit');
    await searchCommand.autocomplete?.(interaction, commandContext());
    const [choices] = interaction.responses as Choice[][];
    assert.equal(choices?.length, 8);
    assert.deepEqual(choices?.[0], { name: 'Emma (British female) · grade B- · Kokoro', value: 'kokoro:bf_emma' });

    const empty = fakeAutocomplete('search', '');
    await searchCommand.autocomplete?.(empty, commandContext());
    const [mixed] = empty.responses as Choice[][];
    assert.ok(mixed?.some((choice) => choice.value.startsWith('pocket:')));
    assert.ok(mixed?.some((choice) => choice.value.startsWith('kokoro:zf_')));
  });
});

describe('/voice picker', () => {
  it('changes page with the buttons', async () => {
    const interaction = fakeComponent('voice:next:all:0');
    await voiceCommand.component?.(interaction, commandContext());
    assert.match((interaction.updates[0] as View).content, /page 2 of 3/);
  });

  it('switches filter and starts at its first page', async () => {
    const interaction = fakeComponent('voice:filter:all:2', ['kokoro-zh']);
    await voiceCommand.component?.(interaction, commandContext());
    const view = interaction.updates[0] as View;
    assert.match(view.content, /Kokoro Mandarin Chinese, page 1 of 1/);
    assert.equal(view.components[1]?.components[0]?.options?.length, 8);
  });

  it('saves the picked voice, switches its model and confirms in place', async () => {
    const preferences = memoryPreferences();
    const interaction = fakeComponent('voice:pick:kokoro-zh:0', ['kokoro:zf_xiaoxiao']);
    await voiceCommand.component?.(interaction, commandContext({ preferences }));
    assert.deepEqual(preferences.get(USER_ID), { model: 'kokoro', voice: 'zf_xiaoxiao', announceName: true, customVoices: true });
    const view = interaction.updates[0] as View;
    assert.match(view.content, /✅ Your \/tts messages will now use Xiaoxiao \(Chinese female\) · grade D · Kokoro/);
    assert.equal(view.components[1]?.components[0]?.options?.find((option) => option.default)?.value, 'kokoro:zf_xiaoxiao');
  });
});

describe('/customvoice', () => {
  it('switches to the custom voice and its model', async () => {
    const preferences = onKokoro();
    const interaction = fakeInteraction({ commandName: 'customvoice', strings: { name: 'custom:tony_balogna' } });
    await customVoiceCommand.execute(interaction, commandContext({ preferences }));
    assert.deepEqual(preferences.get(USER_ID), { model: 'pocket', voice: 'custom:tony_balogna', announceName: true, customVoices: true });
    assert.equal(contentOf(interaction.replies[0]), 'Your /tts messages will now use the custom voice Tony Balogna (Pocket TTS).');
  });

  it('lists the custom voices when no name is given', async () => {
    const interaction = fakeInteraction({ commandName: 'customvoice' });
    await customVoiceCommand.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /Custom voices: rekp, Tony Balogna\./);
  });

  it('rejects names that are not custom voices', async () => {
    const preferences = memoryPreferences();
    const interaction = fakeInteraction({ commandName: 'customvoice', strings: { name: 'alba' } });
    await customVoiceCommand.execute(interaction, commandContext({ preferences }));
    assert.deepEqual(preferences.stored(), {});
    assert.match(contentOf(interaction.replies[0]), /isn't a custom voice/);
  });

  it('suggests custom voices while typing', async () => {
    const interaction = fakeAutocomplete('customvoice', 'ton');
    await customVoiceCommand.autocomplete?.(interaction, commandContext());
    assert.deepEqual(interaction.responses, [[{ name: 'Tony Balogna (custom) · Pocket TTS', value: 'pocket:custom:tony_balogna' }]]);
  });

  it('opens the /voice picker on the Custom voices filter for a custom voice', async () => {
    const preferences = memoryPreferences({ [USER_ID]: { voices: { pocket: 'custom:rekp' } } });
    const interaction = fakeInteraction({ commandName: 'voice' });
    await voiceCommand.execute(interaction, commandContext({ preferences }));
    assert.match(contentOf(interaction.replies[0]), /Your voice: \*\*rekp \(custom\) · Pocket TTS\*\*/);
    assert.match(contentOf(interaction.replies[0]), /Showing Custom voices, page 1 of 1/);
  });
});

describe('custom voices in two models', () => {
  const catalog = createModelCatalog(
    [
      loadedModel('pocket', 'Pocket TTS', [...POCKET_VOICES, ...CUSTOM_VOICES], 'alba'),
      loadedModel('kokoro', 'Kokoro', KOKORO_VOICES_BY_GRADE, 'af_heart'),
      loadedModel('neutts', 'NeuTTS Air', [{ id: 'jo', label: 'Jo' }, { id: 'custom:rekp', label: 'rekp', custom: true }], 'jo'),
    ],
    'pocket',
  );
  const entries = entriesInGroup(voiceEntries(catalog), CUSTOM_GROUP.id);

  it('lists each version under Custom voices, Pocket first', () => {
    assert.deepEqual(entries.map(entryValue), ['pocket:custom:rekp', 'pocket:custom:tony_balogna', 'neutts:custom:rekp']);
  });

  it('prefers the current model\'s version for a bare name, and honours an exact pick', () => {
    assert.equal(findCustomEntry(entries, 'rekp', 'neutts')?.model.id, 'neutts');
    assert.equal(findCustomEntry(entries, 'custom:rekp', 'pocket')?.model.id, 'pocket');
    assert.equal(findCustomEntry(entries, 'rekp', 'kokoro')?.model.id, 'pocket', 'otherwise the first listed');
    assert.equal(findCustomEntry(entries, 'neutts:custom:rekp', 'pocket')?.model.id, 'neutts');
    assert.equal(findCustomEntry(entries, 'Tony Balogna', 'neutts')?.model.id, 'pocket');
    assert.equal(findCustomEntry(entries, 'nobody', 'pocket'), undefined);
  });

  it('switches to NeuTTS when its version is picked', async () => {
    const preferences = memoryPreferences({}, catalog);
    const interaction = fakeInteraction({ commandName: 'customvoice', strings: { name: 'neutts:custom:rekp' } });
    await customVoiceCommand.execute(interaction, commandContext({ preferences, catalog }));
    assert.deepEqual(preferences.get(USER_ID), { model: 'neutts', voice: 'custom:rekp', announceName: true, customVoices: true });
    assert.equal(contentOf(interaction.replies[0]), 'Your /tts messages will now use the custom voice rekp (NeuTTS Air).');
  });
});
