import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import { createTtsCommand } from '../../src/commands/tts.ts';
import {
  OTHER_CHANNEL_ID,
  USER_ID,
  commandContext,
  contentOf,
  fakeInteraction,
  fakeMember,
  fakeSpeaker,
  fakeSpeakers,
  fakeVoiceChannel,
  isEphemeral,
  memoryPreferences,
  testConfig,
} from '../helpers/fakes.ts';

const tts = createTtsCommand(300);

describe('/tts', () => {
  it('limits the text option to the configured length', () => {
    const option = tts.data.options?.[0];
    assert.ok(option && 'max_length' in option);
    assert.equal(option.max_length, 300);
  });

  it('joins the caller\'s channel and reads the cleaned message', async () => {
    const speakers = fakeSpeakers();
    const preferences = memoryPreferences({ [USER_ID]: { voice: 'bm_george' } });
    const interaction = fakeInteraction({ strings: { text: '**gg** everyone 🎉' }, member: fakeMember({ displayName: '✨Alex✨' }) });
    await tts.execute(interaction, commandContext({ speakers, preferences }));

    assert.equal(speakers.connected.length, 1);
    assert.deepEqual(speakers.current?.spoken, [
      { authorId: USER_ID, authorName: 'Alex', announceName: true, text: 'gg everyone', sid: 26 },
    ]);
    assert.deepEqual(interaction.replies.map((reply) => reply.kind), ['defer', 'edit']);
    const edit = interaction.replies[1];
    assert.equal(contentOf(edit), '🔊 **gg** everyone 🎉');
    assert.deepEqual((edit?.payload as { allowedMentions: unknown }).allowedMentions, { parse: [] });
  });

  it('deletes the public reply after the configured delay', async () => {
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    // 0.0005 minutes = 30 ms
    await tts.execute(interaction, commandContext({ config: testConfig({ REPLY_DELETE_MINUTES: '0.0005' }) }));
    assert.deepEqual(interaction.deletions, []);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(interaction.deletions, ['interaction']);
  });

  it('keeps the public reply when deletion is turned off', async () => {
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ config: testConfig({ REPLY_DELETE_MINUTES: '0' }) }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(interaction.deletions, []);
  });

  it('passes the caller\'s announce preference through', async () => {
    const speakers = fakeSpeakers();
    const preferences = memoryPreferences({ [USER_ID]: { announceName: false } });
    await tts.execute(fakeInteraction({ strings: { text: 'hi' } }), commandContext({ speakers, preferences }));
    assert.equal(speakers.current?.spoken[0]?.announceName, false);
  });

  it('asks the caller to join a voice channel first', async () => {
    const interaction = fakeInteraction({ strings: { text: 'hi' }, member: fakeMember({ channel: null }) });
    await tts.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /Join a voice channel/);
    assert.equal(isEphemeral(interaction.replies[0]), true);
  });

  it('refuses when already talking in another channel', async () => {
    const speakers = fakeSpeakers(fakeSpeaker(OTHER_CHANNEL_ID));
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers }));
    assert.match(contentOf(interaction.replies[0]), /already talking/);
    assert.equal(speakers.connected.length, 0);
  });

  it('refuses when the queue is full', async () => {
    const speaker = fakeSpeaker();
    speaker.isFull = true;
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers: fakeSpeakers(speaker) }));
    assert.match(contentOf(interaction.replies[0]), /queue is full/);
    assert.equal(speaker.spoken.length, 0);
  });

  it('explains missing permissions before joining', async () => {
    const channel = fakeVoiceChannel({ permissions: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] });
    const speakers = fakeSpeakers();
    const interaction = fakeInteraction({ strings: { text: 'hi' }, member: fakeMember({ channel }) });
    await tts.execute(interaction, commandContext({ speakers }));
    assert.match(contentOf(interaction.replies[0]), /Speak permission/);
    assert.equal(speakers.connected.length, 0);
  });

  it('refuses messages with nothing to read', async () => {
    const interaction = fakeInteraction({ strings: { text: '🎉🎉' } });
    await tts.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /nothing in that message/);
  });

  it('reports a failed join', async () => {
    const speakers = fakeSpeakers();
    speakers.connectError = new Error('timeout');
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers }));
    assert.match(contentOf(interaction.replies.at(-1)), /couldn't join/);
  });

  it('only works in servers', async () => {
    const interaction = fakeInteraction({ strings: { text: 'hi' }, inGuild: false });
    await tts.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /in a server/);
  });
});
