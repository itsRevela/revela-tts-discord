import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LOCKED, customVoiceCommand } from '../../src/commands/customVoice.ts';
import { UNLOCKED, createUnlockCommand } from '../../src/commands/unlock.ts';
import { searchCommand } from '../../src/commands/search.ts';
import { voiceCommand } from '../../src/commands/voice.ts';
import type { Logger } from '../../src/logging/logger.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { createAttemptLimiter } from '../../src/unlock/attemptLimiter.ts';
import {
  USER_ID,
  commandContext,
  contentOf,
  fakeAutocomplete,
  fakeInteraction,
  isEphemeral,
  memoryPreferences,
  testCatalog,
  testConfig,
} from '../helpers/fakes.ts';

const PASSWORD = 'correct horse';
const lockedConfig = () => testConfig({ CUSTOM_VOICES_PASSWORD: PASSWORD });
const lockedPreferences = (initial = {}) => memoryPreferences(initial, testCatalog(), true);

async function unlock(typed: string, preferences = lockedPreferences(), logger: Logger = silentLogger, command = createUnlockCommand()) {
  const interaction = fakeInteraction({ commandName: 'unlock', strings: { password: typed } });
  await command.execute(interaction, commandContext({ config: lockedConfig(), preferences, logger }));
  return { reply: contentOf(interaction.replies[0]), ephemeral: isEphemeral(interaction.replies[0]), preferences };
}

describe('/unlock', () => {
  it('unlocks custom voices with the right password, privately and for good', async () => {
    const { reply, ephemeral, preferences } = await unlock(PASSWORD);
    assert.equal(reply, UNLOCKED);
    assert.equal(ephemeral, true);
    assert.equal(preferences.get(USER_ID).customVoices, true);
    assert.deepEqual(preferences.stored()[USER_ID], { customVoicesUnlocked: true });
    assert.match((await unlock(PASSWORD, preferences)).reply, /already unlocked/);
  });

  it('refuses a wrong password without logging what was typed', async () => {
    const logged: string[] = [];
    const logger: Logger = { ...silentLogger, info: (message, fields) => logged.push(`${message} ${JSON.stringify(fields)}`) };
    const { reply, preferences } = await unlock('hunter2', lockedPreferences(), logger);
    assert.match(reply, /That password is wrong\. 4 more tries/);
    assert.equal(preferences.get(USER_ID).customVoices, false);
    assert.ok(logged.length === 1 && !logged[0]?.includes('hunter2') && !logged[0]?.includes(PASSWORD));
  });

  it('makes a user wait after too many wrong passwords, even if the next one is right', async () => {
    const command = createUnlockCommand(createAttemptLimiter({ maxFailures: 2, windowMs: 60_000, now: () => 0 }));
    const preferences = lockedPreferences();
    await unlock('nope', preferences, silentLogger, command);
    assert.match((await unlock('nope', preferences, silentLogger, command)).reply, /Try again later/);
    assert.match((await unlock(PASSWORD, preferences, silentLogger, command)).reply, /Too many wrong passwords\. Try again in 1 minute/);
    assert.equal(preferences.get(USER_ID).customVoices, false);
  });

  it('has nothing to unlock when no password is configured', async () => {
    const interaction = fakeInteraction({ commandName: 'unlock', strings: { password: 'x' } });
    await createUnlockCommand().execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /open to everyone/);
  });
});

describe('custom voices while locked', () => {
  it('fall back to the model default for someone who had picked one', () => {
    const stored = { [USER_ID]: { model: 'pocket', voices: { pocket: 'custom:rekp' } } };
    assert.equal(lockedPreferences(stored).get(USER_ID).voice, 'alba');
    assert.equal(lockedPreferences({ [USER_ID]: { ...stored[USER_ID], customVoicesUnlocked: true } }).get(USER_ID).voice, 'custom:rekp');
  });

  it('are refused by /customvoice and left out of its suggestions', async () => {
    const context = commandContext({ config: lockedConfig(), preferences: lockedPreferences() });
    const interaction = fakeInteraction({ commandName: 'customvoice', strings: { name: 'rekp' } });
    await customVoiceCommand.execute(interaction, context);
    assert.equal(contentOf(interaction.replies[0]), LOCKED);
    const suggestions = fakeAutocomplete('customvoice', '');
    await customVoiceCommand.autocomplete?.(suggestions, context);
    assert.deepEqual(suggestions.responses, [[]]);
  });

  it('are hidden from /voice and /search and refused when typed', async () => {
    const context = commandContext({ config: lockedConfig(), preferences: lockedPreferences() });
    const typed = fakeInteraction({ commandName: 'search', strings: { query: 'pocket:custom:rekp' } });
    await searchCommand.execute(typed, context);
    assert.equal(contentOf(typed.replies[0]), LOCKED);

    const search = fakeAutocomplete('search', 'custom');
    await searchCommand.autocomplete?.(search, context);
    assert.deepEqual(search.responses, [[]]);

    const picker = fakeInteraction({ commandName: 'voice' });
    await voiceCommand.execute(picker, context);
    assert.ok(!JSON.stringify(picker.replies[0]?.payload).includes('Custom voices'));
  });
});
