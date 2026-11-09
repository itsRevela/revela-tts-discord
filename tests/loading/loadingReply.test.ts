import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { createLoadingReply, type LoadingReply } from '../../src/loading/loadingReply.ts';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { flush } from '../helpers/fakes.ts';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

interface Recorder {
  readonly edits: string[];
  readonly posted: string[];
  edit(text: string): Promise<string>;
}

function recorder(failWith?: unknown): Recorder {
  const edits: string[] = [];
  const posted: string[] = [];
  return {
    edits,
    posted,
    edit: async (text) => {
      edits.push(text);
      if (failWith !== undefined) throw failWith;
      return `message:${edits.length}`;
    },
  };
}

function make(log: Recorder, logger: Logger = silentLogger): LoadingReply {
  return createLoadingReply({
    content: '🔊 hi',
    edit: (text) => log.edit(text),
    onPosted: (posted) => log.posted.push(posted),
    logger,
    graceMs: 1_500,
    refreshMs: 2_000,
  });
}

describe('createLoadingReply', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
  afterEach(() => mock.timers.reset());

  it('posts only the plain reply when playback starts within the grace period', async () => {
    const log = recorder();
    const loading = make(log);
    loading.update({ stage: 'generating', ahead: 0, progress: undefined, secondsLeft: undefined });
    mock.timers.tick(500);
    loading.update({ stage: 'playing' });
    mock.timers.tick(10_000);
    await settle();
    assert.deepEqual(log.edits, ['🔊 hi']);
    assert.deepEqual(log.posted, ['message:1']);
  });

  it('shows progress after the grace period, refreshes it, never goes backwards, then clears it', async () => {
    const log = recorder();
    const loading = make(log);
    loading.update({ stage: 'generating', ahead: 0, progress: 0.3, secondsLeft: 10 });
    mock.timers.tick(1_500);
    await settle();
    assert.equal(log.edits.at(-1), '🔊 hi\n-# ⏳ Generating voice ▰▰▰▱▱▱▱▱▱▱ 30% · about 9 s');

    loading.update({ stage: 'generating', ahead: 0, progress: 0.2, secondsLeft: 12 }); // the estimate got worse
    mock.timers.tick(2_000);
    await settle();
    assert.equal(log.edits.at(-1), '🔊 hi\n-# ⏳ Generating voice ▰▰▰▱▱▱▱▱▱▱ 30% · about 10 s');

    loading.update({ stage: 'playing' });
    await settle();
    assert.equal(log.edits.at(-1), '🔊 hi');
    assert.deepEqual(log.posted, ['message:1'], 'posted once');
    const count = log.edits.length;
    mock.timers.tick(10_000);
    await settle();
    assert.equal(log.edits.length, count, 'no edits after playback starts');
  });

  it('does not re-send unchanged text', async () => {
    const log = recorder();
    const loading = make(log);
    loading.update({ stage: 'queued', ahead: 2 });
    for (const ms of [1_500, 2_000, 2_000]) {
      mock.timers.tick(ms);
      await settle();
    }
    assert.deepEqual(log.edits, ['🔊 hi\n-# ⏳ In line · 2 messages ahead']);
  });

  it('stops without editing when cancelled', async () => {
    const log = recorder();
    const loading = make(log);
    loading.cancel();
    mock.timers.tick(10_000);
    loading.finish();
    await settle();
    assert.deepEqual(log.edits, []);
  });

  it('stays quiet when the reply was already deleted, and warns on other failures', async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };
    const gone = new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownMessage, message: 'Unknown Message' },
      RESTJSONErrorCodes.UnknownMessage,
      404,
      'PATCH',
      '/webhooks/x',
      {},
    );
    make(recorder(gone), logger).finish();
    await settle();
    assert.deepEqual(warnings, []);
    make(recorder(new Error('Missing Access')), logger).finish();
    await settle();
    assert.deepEqual(warnings, ['Could not update a /tts reply']);
  });
});
