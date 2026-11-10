import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { createReactionProgress, type ReactionProgress } from '../../src/autoRead/reactionProgress.ts';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { flush } from '../helpers/fakes.ts';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

interface Log {
  readonly events: string[];
  readonly progress: ReactionProgress;
}

function tracked(options: { addError?: unknown; logger?: Logger } = {}): Log {
  const events: string[] = [];
  const progress = createReactionProgress({
    add: async () => {
      events.push('add');
      if (options.addError !== undefined) throw options.addError;
      return 'reaction';
    },
    remove: async (reaction) => {
      events.push(`remove:${reaction}`);
    },
    logger: options.logger ?? silentLogger,
    graceMs: 1_500,
  });
  return { events, progress };
}

describe('createReactionProgress', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('never reacts when playback starts within the grace period', async () => {
    const { events, progress } = tracked();
    mock.timers.tick(1_000);
    progress.update({ stage: 'playing' });
    mock.timers.tick(5_000);
    await settle();
    assert.deepEqual(events, []);
  });

  it('reacts while generation is slow and removes the reaction when playback starts', async () => {
    const { events, progress } = tracked();
    progress.update({ stage: 'generating', ahead: 0, progress: 0.2, secondsLeft: 8 });
    mock.timers.tick(1_500);
    await settle();
    assert.deepEqual(events, ['add']);
    progress.update({ stage: 'playing' });
    progress.finish();
    await settle();
    assert.deepEqual(events, ['add', 'remove:reaction'], 'removed once');
  });

  it('stays quiet when reactions are not allowed, and warns on other failures', async () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };
    const forbidden = new DiscordAPIError(
      { code: RESTJSONErrorCodes.MissingPermissions, message: 'Missing Permissions' },
      RESTJSONErrorCodes.MissingPermissions,
      403,
      'PUT',
      '/channels/x/messages/y/reactions',
      {},
    );
    const quiet = tracked({ addError: forbidden, logger });
    mock.timers.tick(1_500);
    quiet.progress.finish();
    await settle();
    assert.deepEqual(quiet.events, ['add'], 'nothing to remove');
    assert.deepEqual(warnings, []);

    const loud = tracked({ addError: new Error('socket hang up'), logger });
    mock.timers.tick(1_500);
    await settle();
    assert.deepEqual(warnings, ['Could not add the auto-read progress reaction']);
    loud.progress.finish();
  });
});
