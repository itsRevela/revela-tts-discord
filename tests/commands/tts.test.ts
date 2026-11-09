import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { PermissionFlagsBits } from 'discord.js';
import { PROBLEM_REPLY_MS, createTtsCommand } from '../../src/commands/tts.ts';
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
  flush,
  isEphemeral,
  memoryPreferences,
  testConfig,
  type FakeSpeakers,
} from '../helpers/fakes.ts';

const tts = createTtsCommand(300);

/** Reports that the first queued message started playing, and lets the reply edits run. */
async function startPlaying(speakers: FakeSpeakers): Promise<void> {
  speakers.current?.spoken[0]?.onStatus?.({ stage: 'playing' });
  for (let i = 0; i < 5; i += 1) await flush();
}

async function finishMessage(speakers: FakeSpeakers): Promise<void> {
  speakers.current?.spoken[0]?.onDone?.();
  for (let i = 0; i < 5; i += 1) await flush();
}

describe('/tts', () => {
  it('limits the text option to the configured length', () => {
    const option = tts.data.options?.[0];
    assert.ok(option && 'max_length' in option);
    assert.equal(option.max_length, 300);
  });

  it('joins the caller\'s channel and reads the cleaned message', async () => {
    const speakers = fakeSpeakers();
    const preferences = memoryPreferences({ [USER_ID]: { model: 'kokoro', voices: { kokoro: 'bm_george' } } });
    const interaction = fakeInteraction({ strings: { text: '**gg** everyone 🎉' }, member: fakeMember({ displayName: '✨Alex✨' }) });
    await tts.execute(interaction, commandContext({ speakers, preferences }));

    assert.equal(speakers.connected.length, 1);
    assert.deepEqual(speakers.current?.spoken.map(({ onDone, onStatus, ...input }) => input), [
      { authorId: USER_ID, authorName: 'Alex', announceName: true, text: 'gg everyone', model: 'kokoro', voiceId: 'bm_george' },
    ]);
    assert.equal(typeof speakers.current?.spoken[0]?.onDone, 'function');
    assert.deepEqual(interaction.replies.map((reply) => reply.kind), ['defer'], 'still "thinking" until playback starts');
    await startPlaying(speakers);
    assert.deepEqual(interaction.replies.map((reply) => reply.kind), ['defer', 'edit']);
    const edit = interaction.replies[1];
    assert.equal(contentOf(edit), '🔊 **gg** everyone 🎉');
    assert.deepEqual((edit?.payload as { allowedMentions: unknown }).allowedMentions, { parse: [] });
  });

  it('deletes the reply once its message is done, and not before', async () => {
    const speakers = fakeSpeakers();
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers }));
    await startPlaying(speakers);
    assert.deepEqual(interaction.deletions, []);
    await finishMessage(speakers);
    assert.deepEqual(interaction.deletions, ['interaction']);
    await finishMessage(speakers);
    assert.deepEqual(interaction.deletions, ['interaction'], 'deleted only once');
  });

  it('keeps the reply after playback when that setting is off', async () => {
    const speakers = fakeSpeakers();
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers, config: testConfig({ REPLY_DELETE_AFTER_PLAYBACK: 'false' }) }));
    await startPlaying(speakers);
    await finishMessage(speakers);
    assert.deepEqual(interaction.deletions, []);
  });

  it('deletes the public reply after the configured delay', async () => {
    const speakers = fakeSpeakers();
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    // 0.0005 minutes = 30 ms
    await tts.execute(interaction, commandContext({ speakers, config: testConfig({ REPLY_DELETE_MINUTES: '0.0005' }) }));
    await startPlaying(speakers);
    assert.deepEqual(interaction.deletions, []);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(interaction.deletions, ['interaction']);
  });

  it('keeps the public reply while the message is still playing and no timer is set', async () => {
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

  it('reports a failed join, then deletes that reply once it has had time to be read', async (context) => {
    context.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const speakers = fakeSpeakers();
    speakers.connectError = new Error('timeout');
    const interaction = fakeInteraction({ strings: { text: 'hi' } });
    await tts.execute(interaction, commandContext({ speakers }));
    assert.match(contentOf(interaction.replies.at(-1)), /couldn't join/);
    mock.timers.tick(PROBLEM_REPLY_MS - 1);
    assert.deepEqual(interaction.deletions, []);
    mock.timers.tick(1);
    assert.deepEqual(interaction.deletions, ['interaction']);
  });

  it('only works in servers', async () => {
    const interaction = fakeInteraction({ strings: { text: 'hi' }, inGuild: false });
    await tts.execute(interaction, commandContext());
    assert.match(contentOf(interaction.replies[0]), /in a server/);
  });
});

describe('/tts progress line', () => {
  it('shows generation progress for slow models, then clears it when playback starts', async (context) => {
    context.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const speakers = fakeSpeakers();
    const interaction = fakeInteraction({ strings: { text: 'hi there' } });
    await tts.execute(interaction, commandContext({ speakers }));
    const report = speakers.current?.spoken[0]?.onStatus;
    report?.({ stage: 'generating', ahead: 0, progress: 0.4, secondsLeft: 9 });
    mock.timers.tick(1_500);
    for (let i = 0; i < 5; i += 1) await flush();
    assert.equal(contentOf(interaction.replies.at(-1)), '🔊 hi there\n-# ⏳ Generating voice ▰▰▰▰▱▱▱▱▱▱ 40% · about 8 s');
    await startPlaying(speakers);
    assert.equal(contentOf(interaction.replies.at(-1)), '🔊 hi there');
  });
});
