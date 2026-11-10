import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { GuildMember, Message } from 'discord.js';
import { handleAutoReadMessage, type AutoReadDependencies } from '../../src/autoRead/autoReadMessages.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import {
  BOT_ID,
  CHANNEL_ID,
  GUILD_ID,
  OTHER_CHANNEL_ID,
  USER_ID,
  fakeMember,
  fakeSpeakers,
  flush,
  memoryPreferences,
  type FakeSpeakers,
} from '../helpers/fakes.ts';

/** The text channel the user turned auto-read on for (distinct from the voice channel CHANNEL_ID). */
const TEXT_CHANNEL_ID = '200000000000000005';

interface MessageOptions {
  content?: string;
  channelId?: string;
  authorId?: string;
  bot?: boolean;
  member?: GuildMember;
  inGuild?: boolean;
}

interface FakeMessage {
  readonly message: Message;
  readonly reactions: string[];
  readonly removed: string[];
}

function fakeMessage(options: MessageOptions = {}): FakeMessage {
  const reactions: string[] = [];
  const removed: string[] = [];
  const guild = {
    id: GUILD_ID,
    members: { me: { id: BOT_ID }, cache: new Map(), fetch: async () => undefined },
    roles: { cache: new Map() },
    channels: { cache: new Map() },
    client: { users: { cache: new Map() } },
  };
  const message = {
    content: options.content ?? 'hello there',
    channelId: options.channelId ?? TEXT_CHANNEL_ID,
    guildId: GUILD_ID,
    guild,
    author: { id: options.authorId ?? USER_ID, bot: options.bot ?? false },
    member: options.member ?? fakeMember(),
    system: false,
    webhookId: null,
    inGuild: () => options.inGuild ?? true,
    react: async (emoji: string) => {
      reactions.push(emoji);
      return { users: { remove: async () => void removed.push(emoji) } };
    },
  };
  return { message: message as unknown as Message, reactions, removed };
}

function setup(maxTextLength = 1000): { speakers: FakeSpeakers; dependencies: AutoReadDependencies } {
  const speakers = fakeSpeakers();
  const preferences = memoryPreferences({ [USER_ID]: { autoRead: { [GUILD_ID]: [TEXT_CHANNEL_ID] } } });
  return { speakers, dependencies: { speakers, preferences, logger: silentLogger, maxTextLength } };
}

describe('handleAutoReadMessage', () => {
  it('reads a message in an auto-read channel like /tts, in the author\'s voice channel', async () => {
    const { speakers, dependencies } = setup();
    await handleAutoReadMessage(fakeMessage({ content: '**gg** everyone' }).message, dependencies);
    assert.equal(speakers.connected[0]?.id, CHANNEL_ID);
    const spoken = speakers.current?.spoken[0];
    assert.equal(spoken?.text, 'gg everyone');
    assert.equal(spoken?.authorId, USER_ID);
    assert.equal(spoken?.model, 'pocket');
  });

  it('ignores other channels, other people, bots and direct messages', async () => {
    const { speakers, dependencies } = setup();
    await handleAutoReadMessage(fakeMessage({ channelId: OTHER_CHANNEL_ID }).message, dependencies);
    await handleAutoReadMessage(fakeMessage({ authorId: '300000000000000009' }).message, dependencies);
    await handleAutoReadMessage(fakeMessage({ bot: true }).message, dependencies);
    await handleAutoReadMessage(fakeMessage({ inGuild: false }).message, dependencies);
    assert.equal(speakers.connected.length, 0);
  });

  it('skips quietly when the author is not in a voice channel or the message has nothing to read', async () => {
    const { speakers, dependencies } = setup();
    const notInVoice = fakeMessage({ member: fakeMember({ channel: null }) });
    await handleAutoReadMessage(notInVoice.message, dependencies);
    await handleAutoReadMessage(fakeMessage({ content: '🎉🎉' }).message, dependencies);
    assert.equal(speakers.connected.length, 0);
    assert.deepEqual(notInVoice.reactions, []);
  });

  it('reads long messages up to the length limit, cut at a word', async () => {
    const { speakers, dependencies } = setup(12);
    await handleAutoReadMessage(fakeMessage({ content: 'one two three four' }).message, dependencies);
    assert.equal(speakers.current?.spoken[0]?.text, 'one two');
  });

  it('shows a progress reaction while generation is slow and removes it when playback starts', async (context) => {
    context.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setTimeout'] });
    const { speakers, dependencies } = setup();
    const fake = fakeMessage();
    await handleAutoReadMessage(fake.message, dependencies);
    mock.timers.tick(1_500);
    for (let i = 0; i < 5; i += 1) await flush();
    assert.deepEqual(fake.reactions, ['⏳']);
    speakers.current?.spoken[0]?.onStatus?.({ stage: 'playing' });
    for (let i = 0; i < 5; i += 1) await flush();
    assert.deepEqual(fake.removed, ['⏳']);
  });
});
