import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { autoReadCommand } from '../../src/commands/autoRead.ts';
import { MAX_AUTO_READ_CHANNELS } from '../../src/preferences/userPreferences.ts';
import {
  GUILD_ID,
  USER_ID,
  commandContext,
  contentOf,
  fakeInteraction,
  fakeVoiceChannel,
  isEphemeral,
  memoryPreferences,
} from '../helpers/fakes.ts';

const textChannel = (id: string, permissions: readonly bigint[] | 'all' = 'all') =>
  fakeVoiceChannel({ id, type: ChannelType.GuildText, permissions });

const HERE = '200000000000000005';
const ELSEWHERE = '200000000000000006';

async function run(subcommand: string, options: { channel?: unknown; here?: unknown } = {}, preferences = memoryPreferences()) {
  const interaction = fakeInteraction({
    commandName: 'autoread',
    subcommand,
    channels: options.channel ? { channel: options.channel } : {},
    channel: options.here ?? textChannel(HERE),
  });
  await autoReadCommand.execute(interaction, commandContext({ preferences }));
  return { interaction, preferences, reply: contentOf(interaction.replies[0]) };
}

describe('/autoread', () => {
  it('adds the current channel by default, privately', async () => {
    const { interaction, preferences, reply } = await run('add');
    assert.deepEqual(preferences.autoReadChannels(USER_ID, GUILD_ID), [HERE]);
    assert.match(reply, /Messages you send in <#200000000000000005> will be read aloud/);
    assert.equal(isEphemeral(interaction.replies[0]), true);
  });

  it('adds several channels and lists them', async () => {
    const preferences = memoryPreferences();
    await run('add', {}, preferences);
    const second = await run('add', { channel: textChannel(ELSEWHERE) }, preferences);
    assert.deepEqual(preferences.autoReadChannels(USER_ID, GUILD_ID), [HERE, ELSEWHERE]);
    assert.match(second.reply, /Auto-read is on in <#200000000000000005>, <#200000000000000006>\./);
    const listed = await run('list', {}, preferences);
    assert.equal(listed.reply, 'Auto-read is on in <#200000000000000005>, <#200000000000000006>.');
  });

  it('removes one channel, or every channel with off', async () => {
    const preferences = memoryPreferences({ [USER_ID]: { autoRead: { [GUILD_ID]: [HERE, ELSEWHERE] } } });
    const removed = await run('remove', {}, preferences);
    assert.deepEqual(preferences.autoReadChannels(USER_ID, GUILD_ID), [ELSEWHERE]);
    assert.match(removed.reply, /Stopped reading your messages in <#200000000000000005>/);
    await run('off', {}, preferences);
    assert.deepEqual(preferences.autoReadChannels(USER_ID, GUILD_ID), []);
    assert.deepEqual(preferences.stored()[USER_ID], {});
  });

  it('refuses channels it cannot read, and notes when it cannot react', async () => {
    const hidden = await run('add', { channel: textChannel(ELSEWHERE, [PermissionFlagsBits.SendMessages]) });
    assert.match(hidden.reply, /can't see <#200000000000000006>/);
    assert.deepEqual(hidden.preferences.autoReadChannels(USER_ID, GUILD_ID), []);

    const noReactions = await run('add', { channel: textChannel(ELSEWHERE, [PermissionFlagsBits.ViewChannel]) });
    assert.match(noReactions.reply, /can't show the ⏳ progress reaction/);
    assert.deepEqual(noReactions.preferences.autoReadChannels(USER_ID, GUILD_ID), [ELSEWHERE]);
  });

  it('refuses channel types it cannot read and caps the channel count', async () => {
    const thread = await run('add', { here: fakeVoiceChannel({ id: HERE, type: ChannelType.PublicThread }) });
    assert.match(thread.reply, /Pick a text channel/);

    const full = Array.from({ length: MAX_AUTO_READ_CHANNELS }, (_, index) => `2100000000000000${String(index).padStart(2, '0')}`);
    const capped = await run('add', {}, memoryPreferences({ [USER_ID]: { autoRead: { [GUILD_ID]: full } } }));
    assert.match(capped.reply, /at most 10 channels/);
  });

  it('says so when removing a channel that was not on', async () => {
    const { reply } = await run('remove');
    assert.equal(reply, "Auto-read isn't on in <#200000000000000005>. Auto-read is off in this server. Use /autoread add to pick a channel.");
  });
});
