import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leaveCommand } from '../../src/commands/leave.ts';
import { skipCommand } from '../../src/commands/skip.ts';
import {
  GUILD_ID,
  OTHER_CHANNEL_ID,
  commandContext,
  contentOf,
  fakeInteraction,
  fakeMember,
  fakeSpeaker,
  fakeSpeakers,
  fakeVoiceChannel,
} from '../helpers/fakes.ts';

const elsewhere = () => fakeMember({ channel: fakeVoiceChannel({ id: OTHER_CHANNEL_ID }) });

describe('/skip', () => {
  it('skips for members in the bot\'s channel', async () => {
    const speaker = fakeSpeaker();
    const interaction = fakeInteraction({ commandName: 'skip' });
    await skipCommand.execute(interaction, commandContext({ speakers: fakeSpeakers(speaker) }));
    assert.equal(speaker.skipped, 1);
    assert.equal(contentOf(interaction.replies[0]), 'Skipped.');
  });

  it('refuses members in another channel', async () => {
    const speaker = fakeSpeaker();
    const interaction = fakeInteraction({ commandName: 'skip', member: elsewhere() });
    await skipCommand.execute(interaction, commandContext({ speakers: fakeSpeakers(speaker) }));
    assert.equal(speaker.skipped, 0);
    assert.match(contentOf(interaction.replies[0]), /Join <#/);
  });

  it('lets members who can move members skip from anywhere', async () => {
    const speaker = fakeSpeaker();
    const member = fakeMember({ channel: null, canMoveMembers: true });
    await skipCommand.execute(fakeInteraction({ commandName: 'skip', member }), commandContext({ speakers: fakeSpeakers(speaker) }));
    assert.equal(speaker.skipped, 1);
  });

  it('says so when the bot is not connected', async () => {
    const interaction = fakeInteraction({ commandName: 'skip' });
    await skipCommand.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /not in a voice channel/);
  });
});

describe('/leave', () => {
  it('disconnects for members in the bot\'s channel', async () => {
    const speakers = fakeSpeakers(fakeSpeaker());
    const interaction = fakeInteraction({ commandName: 'leave' });
    await leaveCommand.execute(interaction, commandContext({ speakers }));
    assert.deepEqual(speakers.disconnected, [GUILD_ID]);
    assert.match(contentOf(interaction.replies[0]), /^Left <#/);
  });

  it('refuses members in another channel', async () => {
    const speakers = fakeSpeakers(fakeSpeaker());
    await leaveCommand.execute(fakeInteraction({ commandName: 'leave', member: elsewhere() }), commandContext({ speakers }));
    assert.deepEqual(speakers.disconnected, []);
  });
});
