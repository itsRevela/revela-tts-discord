import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANNOUNCE_OFF, ANNOUNCE_ON, announceCommand } from '../../src/commands/announce.ts';
import { voiceCommand } from '../../src/commands/voice.ts';
import {
  USER_ID,
  commandContext,
  contentOf,
  fakeAutocomplete,
  fakeInteraction,
  isEphemeral,
  memoryPreferences,
} from '../helpers/fakes.ts';

describe('/announce', () => {
  it('toggles the setting, which starts on', async () => {
    const preferences = memoryPreferences();
    const context = commandContext({ preferences });
    const first = fakeInteraction({ commandName: 'announce' });
    await announceCommand.execute(first, context);
    assert.equal(preferences.get(USER_ID).announceName, false);
    assert.equal(contentOf(first.replies[0]), ANNOUNCE_OFF);
    assert.equal(isEphemeral(first.replies[0]), true);

    const second = fakeInteraction({ commandName: 'announce' });
    await announceCommand.execute(second, context);
    assert.equal(preferences.get(USER_ID).announceName, true);
    assert.equal(contentOf(second.replies[0]), ANNOUNCE_ON);
  });

  it('sets an explicit value', async () => {
    const preferences = memoryPreferences();
    await announceCommand.execute(
      fakeInteraction({ commandName: 'announce', booleans: { enabled: true } }),
      commandContext({ preferences }),
    );
    assert.equal(preferences.get(USER_ID).announceName, true);
  });
});

describe('/voice', () => {
  it('shows the current voice when no name is given', async () => {
    const interaction = fakeInteraction({ commandName: 'voice' });
    await voiceCommand.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /Heart \(American female\)/);
  });

  it('saves a chosen voice', async () => {
    const preferences = memoryPreferences();
    const interaction = fakeInteraction({ commandName: 'voice', strings: { name: 'bm_george' } });
    await voiceCommand.execute(interaction, commandContext({ preferences }));
    assert.equal(preferences.get(USER_ID).voice, 'bm_george');
    assert.match(contentOf(interaction.replies[0]), /George \(British male\)/);
  });

  it('rejects an unknown voice without saving it', async () => {
    const preferences = memoryPreferences();
    const interaction = fakeInteraction({ commandName: 'voice', strings: { name: 'robot' } });
    await voiceCommand.execute(interaction, commandContext({ preferences }));
    assert.deepEqual(preferences.stored(), {});
    assert.match(contentOf(interaction.replies[0]), /isn't one of the available voices/);
  });

  it('suggests matching voices while typing', async () => {
    const interaction = fakeAutocomplete('voice', 'brit');
    await voiceCommand.autocomplete?.(interaction, commandContext());
    const [choices] = interaction.responses as { name: string; value: string }[][];
    assert.equal(choices?.length, 8);
    assert.ok(choices?.every((choice) => choice.value.startsWith('b')));
  });
});
