import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoiceState } from 'discord.js';
import { handleVoiceStateUpdate } from '../../src/discord/voiceStateWatcher.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { BOT_ID, CHANNEL_ID, GUILD_ID, USER_ID, fakeSpeaker, fakeSpeakers } from '../helpers/fakes.ts';

function voiceState(userId: string, channelId: string | null, members: { bot: boolean }[]): VoiceState {
  const channel = {
    isVoiceBased: () => true,
    members: { filter: (keep: (member: { user: { bot: boolean } }) => boolean) => ({
      size: members.map((member) => ({ user: member })).filter(keep).length,
    }) },
  };
  return {
    id: userId,
    channelId,
    client: { user: { id: BOT_ID } },
    guild: { id: GUILD_ID, channels: { cache: new Map([[CHANNEL_ID, channel]]) } },
  } as unknown as VoiceState;
}

describe('handleVoiceStateUpdate', () => {
  it('leaves when the last person leaves the channel', () => {
    const speakers = fakeSpeakers(fakeSpeaker());
    handleVoiceStateUpdate(voiceState(USER_ID, null, [{ bot: true }]), speakers, silentLogger);
    assert.deepEqual(speakers.disconnected, [GUILD_ID]);
  });

  it('stays while people remain', () => {
    const speakers = fakeSpeakers(fakeSpeaker());
    handleVoiceStateUpdate(voiceState(USER_ID, null, [{ bot: true }, { bot: false }]), speakers, silentLogger);
    assert.deepEqual(speakers.disconnected, []);
  });

  it('cleans up when the bot itself is disconnected', () => {
    const speakers = fakeSpeakers(fakeSpeaker());
    handleVoiceStateUpdate(voiceState(BOT_ID, null, [{ bot: false }]), speakers, silentLogger);
    assert.deepEqual(speakers.disconnected, [GUILD_ID]);
  });

  it('drops the speech of anyone who is not in the bot\'s channel', () => {
    const speaker = fakeSpeaker();
    const speakers = fakeSpeakers(speaker);
    handleVoiceStateUpdate(voiceState(USER_ID, '200000000000000009', [{ bot: true }, { bot: false }]), speakers, silentLogger);
    handleVoiceStateUpdate(voiceState('300000000000000002', CHANNEL_ID, [{ bot: true }, { bot: false }]), speakers, silentLogger);
    assert.deepEqual(speaker.droppedAuthors, [USER_ID], 'only the one who moved away');
  });

  it('ignores guilds where the bot is not speaking', () => {
    const speakers = fakeSpeakers();
    handleVoiceStateUpdate(voiceState(USER_ID, null, []), speakers, silentLogger);
    assert.deepEqual(speakers.disconnected, []);
  });
});
