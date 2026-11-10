import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, parseConfig } from '../../src/config/config.ts';

describe('parseConfig', () => {
  it('applies defaults when only the token is set', () => {
    const config = parseConfig({ DISCORD_TOKEN: 'abc' });
    assert.equal(config.discordToken, 'abc');
    assert.equal(config.guildId, undefined);
    assert.equal(config.modelsDir, '/models');
    assert.deepEqual(config.models, ['phonon', 'pocket', 'neutts', 'kokoro']);
    assert.equal(config.defaultModel, 'phonon');
    assert.equal(config.defaultVoice, undefined);
    assert.equal(config.ttsThreads, 4);
    assert.equal(config.ttsSpeed, 1);
    assert.equal(config.maxTextLength, 300);
    assert.equal(config.maxQueueLength, 10);
    assert.equal(config.idleTimeoutMs, 15 * 60_000);
    assert.equal(config.replyDeleteAfterPlayback, true);
    assert.equal(config.replyDeleteMs, 0);
    assert.equal(config.dataDir, '/data');
    assert.equal(config.logLevel, 'info');
  });

  it('has uploaded-voice defaults and reads owners and the mod log channel', () => {
    const defaults = parseConfig({ DISCORD_TOKEN: 'abc' });
    assert.deepEqual(defaults.userVoices, { uploadsEnabled: true, maxPerUser: 5, maxTotal: 200, maxBytes: 10 * 1024 * 1024, uploadsPerWindow: 3 });
    assert.deepEqual(defaults.ownerUserIds, []);
    assert.equal(defaults.modLogChannelId, undefined);
    const set = parseConfig({
      DISCORD_TOKEN: 'abc',
      USER_VOICE_UPLOADS: 'off',
      USER_VOICE_MAX_PER_USER: '8',
      OWNER_USER_IDS: '300000000000000001, 300000000000000002',
      MOD_LOG_CHANNEL_ID: '200000000000000009',
    });
    assert.equal(set.userVoices.uploadsEnabled, false);
    assert.equal(set.userVoices.maxPerUser, 8);
    assert.deepEqual(set.ownerUserIds, ['300000000000000001', '300000000000000002']);
    assert.equal(set.modLogChannelId, '200000000000000009');
    assert.throws(() => parseConfig({ DISCORD_TOKEN: 'abc', OWNER_USER_IDS: 'revela' }), (error: unknown) =>
      error instanceof ConfigError && error.problems.some((item) => item.includes('OWNER_USER_IDS')));
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
      DEFAULT_MODEL: 'kokoro',
      DEFAULT_VOICE: 'BM_George',
      IDLE_TIMEOUT_MINUTES: '0',
      REPLY_DELETE_MINUTES: '30',
      REPLY_DELETE_AFTER_PLAYBACK: 'off',
      LOG_LEVEL: 'DEBUG',
    });
    assert.equal(config.replyDeleteMs, 30 * 60_000);
    assert.equal(config.replyDeleteAfterPlayback, false);
    assert.throws(() => parseConfig({ DISCORD_TOKEN: 'abc', REPLY_DELETE_AFTER_PLAYBACK: 'sometimes' }), (error: unknown) =>
      error instanceof ConfigError && error.problems.some((problem) => problem.includes('REPLY_DELETE_AFTER_PLAYBACK')));
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
        DEFAULT_MODEL: 'kokoro',
        DEFAULT_VOICE: 'alba',
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

  it('loads only the listed models and checks the default against them', () => {
    const config = parseConfig({ DISCORD_TOKEN: 'abc', TTS_MODELS: ' Kokoro , kokoro ' });
    assert.deepEqual(config.models, ['kokoro']);
    assert.equal(config.defaultModel, 'kokoro');
    assert.throws(
      () => parseConfig({ DISCORD_TOKEN: 'abc', TTS_MODELS: 'kokoro', DEFAULT_MODEL: 'pocket' }),
      (error: unknown) => error instanceof ConfigError && error.problems.some((problem) => problem.includes('DEFAULT_MODEL')),
    );
  });

  it('rejects unknown models and voices that the default model lacks', () => {
    assert.throws(
      () => parseConfig({ DISCORD_TOKEN: 'abc', TTS_MODELS: 'pocket,piper' }),
      (error: unknown) => error instanceof ConfigError && error.problems.some((problem) => problem.includes('piper')),
    );
    assert.throws(
      () => parseConfig({ DISCORD_TOKEN: 'abc', DEFAULT_MODEL: 'kokoro', DEFAULT_VOICE: 'alba' }),
      (error: unknown) => error instanceof ConfigError && error.problems.some((problem) => problem.includes('kokoro')),
    );
    assert.equal(parseConfig({ DISCORD_TOKEN: 'abc', DEFAULT_MODEL: 'kokoro', DEFAULT_VOICE: 'AF_Heart' }).defaultVoice, 'af_heart');
  });

  it('defaults to Phonon, or the first listed model without it, and defers server voices to load time', () => {
    assert.equal(parseConfig({ DISCORD_TOKEN: 'abc', TTS_MODELS: 'kokoro,phonon' }).defaultModel, 'phonon');
    assert.equal(parseConfig({ DISCORD_TOKEN: 'abc', TTS_MODELS: 'kokoro,pocket' }).defaultModel, 'kokoro');
    // Phonon's voices come from its server, so any name is accepted here and checked once it is loaded.
    assert.equal(parseConfig({ DISCORD_TOKEN: 'abc', DEFAULT_VOICE: 'Zoey' }).defaultVoice, 'Zoey');
  });
});
