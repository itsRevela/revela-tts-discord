import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import { createGuildSpeakers, type SpeakInput } from '../../src/playback/guildSpeakers.ts';
import type { OpenVoiceSession, OpenVoiceSessionOptions } from '../../src/playback/voiceSession.ts';
import { CHANNEL_ID, GUILD_ID, fakeEngine, fakePlayer, fakeVoiceChannel, flush } from '../helpers/fakes.ts';

interface SessionLog {
  opened: number;
  destroyed: number;
  close: () => void;
}

function fakeSessions(): { open: OpenVoiceSession; log: SessionLog } {
  const log: SessionLog = { opened: 0, destroyed: 0, close: () => undefined };
  const open: OpenVoiceSession = async (options: OpenVoiceSessionOptions) => {
    log.opened += 1;
    await flush();
    log.close = options.onClosed;
    return {
      guildId: GUILD_ID,
      channelId: options.channel.id,
      player: fakePlayer(),
      destroy: () => {
        log.destroyed += 1;
        options.onClosed();
      },
    };
  };
  return { open, log };
}

const message = (authorId: string, text: string, announceName = true): SpeakInput => ({
  authorId,
  authorName: authorId === 'alex' ? 'Alex' : 'Bob',
  announceName,
  text,
  sid: 3,
});

describe('createGuildSpeakers', () => {
  it('joins once even when two messages arrive together', async () => {
    const { open, log } = fakeSessions();
    const speakers = createGuildSpeakers({ engine: fakeEngine(), logger: silentLogger, maxQueueLength: 5, idleTimeoutMs: 0, openSession: open });
    const [first, second] = await Promise.all([
      speakers.connect(fakeVoiceChannel()),
      speakers.connect(fakeVoiceChannel()),
    ]);
    assert.equal(log.opened, 1);
    assert.equal(first, second);
    assert.equal(speakers.get(GUILD_ID)?.channelId, CHANNEL_ID);
  });

  it('names a speaker only when the speaker changes and they allow it', async () => {
    const engine = fakeEngine();
    const { open } = fakeSessions();
    const speakers = createGuildSpeakers({ engine, logger: silentLogger, maxQueueLength: 10, idleTimeoutMs: 0, openSession: open });
    const speaker = await speakers.connect(fakeVoiceChannel());
    speaker.speak(message('alex', 'hi'));
    speaker.speak(message('alex', 'again'));
    speaker.speak(message('bob', 'yo', false));
    speaker.speak(message('alex', 'back'));
    await flush();
    await flush();
    assert.deepEqual(engine.requests.map((request) => request.text), ['Alex says, hi', 'again', 'yo', 'Alex says, back']);
  });

  it('reports a full queue without changing the last speaker', async () => {
    const engine = fakeEngine();
    const { open } = fakeSessions();
    const speakers = createGuildSpeakers({ engine, logger: silentLogger, maxQueueLength: 1, idleTimeoutMs: 0, openSession: open });
    const speaker = await speakers.connect(fakeVoiceChannel());
    assert.equal(speaker.speak(message('alex', 'one')), 'queued');
    assert.equal(speaker.speak(message('bob', 'two')), 'full');
  });

  it('forgets the guild when disconnected or when the connection closes', async () => {
    const { open, log } = fakeSessions();
    const speakers = createGuildSpeakers({ engine: fakeEngine(), logger: silentLogger, maxQueueLength: 5, idleTimeoutMs: 0, openSession: open });
    await speakers.connect(fakeVoiceChannel());
    assert.equal(speakers.disconnect(GUILD_ID), true);
    assert.equal(log.destroyed, 1);
    assert.equal(speakers.get(GUILD_ID), undefined);
    assert.equal(speakers.disconnect(GUILD_ID), false);

    await speakers.connect(fakeVoiceChannel());
    log.close();
    assert.equal(speakers.get(GUILD_ID), undefined);
  });

  it('leaves after the idle timeout', async () => {
    const { open, log } = fakeSessions();
    const speakers = createGuildSpeakers({ engine: fakeEngine(), logger: silentLogger, maxQueueLength: 5, idleTimeoutMs: 20, openSession: open });
    await speakers.connect(fakeVoiceChannel());
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(log.destroyed, 1);
    assert.equal(speakers.get(GUILD_ID), undefined);
  });
});
