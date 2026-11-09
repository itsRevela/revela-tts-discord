import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { scheduleReplyDeletion, type DeletableReply } from '../../src/discord/replyCleanup.ts';

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
