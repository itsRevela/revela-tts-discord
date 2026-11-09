import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANNOUNCE_OFF, ANNOUNCE_ON, announceCommand } from '../../src/commands/announce.ts';
import {
  USER_ID,
  commandContext,
  contentOf,
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
