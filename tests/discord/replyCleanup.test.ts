import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { createReplyCleanup, scheduleReplyDeletion, settleReplyDeletions, type DeletableReply } from '../../src/discord/replyCleanup.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function recordingReply(failWith?: unknown): DeletableReply & { readonly calls: string[] } {
  const calls: string[] = [];
  const settle = async (via: string): Promise<void> => {
    calls.push(via);
    if (failWith !== undefined) throw failWith;
  };
  return { calls, deleteViaInteraction: () => settle('interaction'), deleteViaChannel: () => settle('channel') };
}

function warningsTo(list: string[]): Logger {
  return { ...silentLogger, warn: (message) => list.push(message) };
}

describe('scheduleReplyDeletion', () => {
  it('deletes through the interaction while its token is still valid', async () => {
    const reply = recordingReply();
    scheduleReplyDeletion(reply, 10, silentLogger);
    assert.deepEqual(reply.calls, []);
    await wait(40);
    assert.deepEqual(reply.calls, ['interaction']);
  });

  it('deletes through the channel when the delay outlives the interaction token', async () => {
    const reply = recordingReply();
    scheduleReplyDeletion(reply, 10, silentLogger, 5);
    await wait(40);
    assert.deepEqual(reply.calls, ['channel']);
  });

  it('keeps the reply when the delay is 0', async () => {
    const reply = recordingReply();
    scheduleReplyDeletion(reply, 0, silentLogger);
    await wait(20);
    assert.deepEqual(reply.calls, []);
  });

  it('stays quiet when someone already deleted the reply', async () => {
    const warnings: string[] = [];
    const unknownMessage = new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownMessage, message: 'Unknown Message' },
      RESTJSONErrorCodes.UnknownMessage,
      404,
      'DELETE',
      '/webhooks/x/y/messages/@original',
      {},
    );
    scheduleReplyDeletion(recordingReply(unknownMessage), 5, warningsTo(warnings));
    await wait(30);
    assert.deepEqual(warnings, []);
  });

  it('logs other failures', async () => {
    const warnings: string[] = [];
    scheduleReplyDeletion(recordingReply(new Error('Missing Access')), 5, warningsTo(warnings));
    await wait(30);
    assert.deepEqual(warnings, ['Could not delete a /tts reply']);
  });
});

describe('createReplyCleanup', () => {
  it('deletes once both posted and done, in either order, and only once', () => {
    const first = recordingReply();
    const postedFirst = createReplyCleanup(silentLogger);
    postedFirst.posted(first);
    assert.deepEqual(first.calls, []);
    postedFirst.done();
    postedFirst.done();
    assert.deepEqual(first.calls, ['interaction']);

    const second = recordingReply();
    const doneFirst = createReplyCleanup(silentLogger);
    doneFirst.done();
    doneFirst.posted(second);
    assert.deepEqual(second.calls, ['interaction']);
  });

  it('deletes through the channel once the interaction token has expired', () => {
    let clock = 0;
    const reply = recordingReply();
    const cleanup = createReplyCleanup(silentLogger, () => clock, 1_000);
    cleanup.posted(reply);
    clock = 1_001;
    cleanup.done();
    assert.deepEqual(reply.calls, ['channel']);
  });
});

describe('settleReplyDeletions', () => {
  it('waits for deletions already started, but no longer than the timeout', async () => {
    let finish = (): void => undefined;
    const slow: DeletableReply = {
      deleteViaInteraction: () => new Promise<void>((resolve) => { finish = resolve; }),
      deleteViaChannel: async () => undefined,
    };
    const cleanup = createReplyCleanup(silentLogger);
    cleanup.posted(slow);
    cleanup.done();
    let settled = false;
    const waiting = settleReplyDeletions(1_000).then(() => { settled = true; });
    await wait(10);
    assert.equal(settled, false);
    finish();
    await waiting;
    assert.equal(settled, true);

    const hanging: DeletableReply = { deleteViaInteraction: () => new Promise(() => undefined), deleteViaChannel: async () => undefined };
    const stuck = createReplyCleanup(silentLogger);
    stuck.posted(hanging);
    stuck.done();
    const started = Date.now();
    await settleReplyDeletions(30);
    assert.ok(Date.now() - started < 500);
  });
});
