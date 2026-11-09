import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, parseConfig } from '../../src/config/config.ts';

describe('parseConfig', () => {
  it('applies defaults when only the token is set', () => {
    const config = parseConfig({ DISCORD_TOKEN: 'abc' });
    assert.equal(config.discordToken, 'abc');
    assert.equal(config.guildId, undefined);
    assert.equal(config.modelDir, '/models/kokoro');
    assert.equal(config.ttsThreads, 4);
    assert.equal(config.ttsSpeed, 1);
    assert.equal(config.defaultVoice, 'af_heart');
    assert.equal(config.maxTextLength, 300);
    assert.equal(config.maxQueueLength, 10);
    assert.equal(config.idleTimeoutMs, 15 * 60_000);
    assert.equal(config.replyDeleteMs, 5 * 60_000);
    assert.equal(config.dataDir, '/data');
    assert.equal(config.logLevel, 'info');
  });

  it('requires a token', () => {
    assert.throws(() => parseConfig({}), (error: unknown) =>
      error instanceof ConfigError && error.problems.some((problem) => problem.includes('DISCORD_TOKEN')));
  });

  it('reads overrides', () => {
    const config = parseConfig({
      DISCORD_TOKEN: 'abc',
      DISCORD_GUILD_ID: '123456789012345678',
      TTS_THREADS: '6',
      TTS_SPEED: '1.2',
      DEFAULT_VOICE: 'BM_George',
      IDLE_TIMEOUT_MINUTES: '0',
      REPLY_DELETE_MINUTES: '30',
      LOG_LEVEL: 'DEBUG',
    });
    assert.equal(config.replyDeleteMs, 30 * 60_000);
    assert.equal(config.guildId, '123456789012345678');
    assert.equal(config.ttsThreads, 6);
    assert.equal(config.ttsSpeed, 1.2);
    assert.equal(config.defaultVoice, 'bm_george');
    assert.equal(config.idleTimeoutMs, 0);
    assert.equal(config.logLevel, 'debug');
  });

  it('reports every invalid value at once', () => {
    assert.throws(
      () => parseConfig({
        DISCORD_TOKEN: 'abc',
        DISCORD_GUILD_ID: 'not-an-id',
        TTS_THREADS: '2.5',
        TTS_SPEED: '9',
        DEFAULT_VOICE: 'zf_xiaobei',
        LOG_LEVEL: 'loud',
      }),
      (error: unknown) => error instanceof ConfigError && error.problems.length === 5,
    );
  });

  it('treats blank values as unset', () => {
    const config = parseConfig({ DISCORD_TOKEN: 'abc', DISCORD_GUILD_ID: '  ', TTS_THREADS: '' });
    assert.equal(config.guildId, undefined);
    assert.equal(config.ttsThreads, 4);
  });
});
