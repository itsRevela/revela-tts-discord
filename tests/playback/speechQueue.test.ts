import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { SpeechQueue } from '../../src/playback/speechQueue.ts';
import { fakeEngine, fakePlayer, flush } from '../helpers/fakes.ts';

/** Fake chunks hold 10 samples per character at 24 kHz: 20 frames at 48 kHz, 4 bytes per stereo frame. */
const bytesFor = (text: string): number => text.length * 10 * 2 * 4;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SpeechQueue', () => {
  it('plays every sentence of every message in order', async () => {
    const engine = fakeEngine();
    const player = fakePlayer();
    const queue = new SpeechQueue({ engine, player, maxLength: 5, logger: silentLogger });
    queue.enqueue({ text: 'one|three', sid: 3 });
    queue.enqueue({ text: 'seventeen', sid: 11 });
    await flush();
    await flush();
    assert.deepEqual(player.played.map((clip) => clip.length), [bytesFor('one'), bytesFor('three'), bytesFor('seventeen')]);
    assert.deepEqual(engine.requests.map((request) => request.sid), [3, 11]);
    assert.equal(queue.size, 0);
  });

  it('starts playing the first sentence before the rest is synthesized', async () => {
    const engine = fakeEngine();
    const gate = deferred();
    engine.gate = gate.promise;
    const player = fakePlayer();
    const queue = new SpeechQueue({ engine, player, maxLength: 5, logger: silentLogger });
    queue.enqueue({ text: 'first|second', sid: 3 });
    await flush();
    assert.equal(player.played.length, 1);
    gate.resolve();
    await flush();
    await flush();
    assert.equal(player.played.length, 2);
  });

  it('refuses messages beyond the maximum length', () => {
    const queue = new SpeechQueue({ engine: fakeEngine(), player: fakePlayer(false), maxLength: 2, logger: silentLogger });
    assert.equal(queue.enqueue({ text: 'a', sid: 0 }), true);
    assert.equal(queue.enqueue({ text: 'b', sid: 0 }), true);
    assert.equal(queue.isFull, true);
    assert.equal(queue.enqueue({ text: 'c', sid: 0 }), false);
  });

  it('skips the current message, cancels its synthesis and moves on', async () => {
    const engine = fakeEngine();
    const gate = deferred();
    engine.gate = gate.promise;
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ engine, player, maxLength: 5, logger: silentLogger });
    queue.enqueue({ text: 'long|message|here', sid: 3 });
    queue.enqueue({ text: 'next', sid: 3 });
    await flush();
    assert.equal(player.played.length, 1);

    assert.equal(queue.skip(), true);
    assert.equal(player.stops, 1);
    assert.equal(engine.requests[0]?.signal?.aborted, true);
    engine.gate = undefined;
    gate.resolve();
    await flush();
    await flush();
    assert.equal(player.played.at(-1)?.length, bytesFor('next'));
    player.finishCurrent();
    await flush();
    assert.equal(queue.size, 0);
  });

  it('reports nothing to skip when empty', () => {
    const queue = new SpeechQueue({ engine: fakeEngine(), player: fakePlayer(), maxLength: 5, logger: silentLogger });
    assert.equal(queue.skip(), false);
  });

  it('logs a failed synthesis and continues with the next message', async () => {
    const errors: string[] = [];
    const logger: Logger = { ...silentLogger, error: (message) => errors.push(message) };
    const engine = fakeEngine();
    engine.failNext = true;
    const player = fakePlayer();
    const queue = new SpeechQueue({ engine, player, maxLength: 5, logger });
    queue.enqueue({ text: 'broken', sid: 3 });
    queue.enqueue({ text: 'fine', sid: 3 });
    await flush();
    await flush();
    assert.deepEqual(errors, ['Speech synthesis failed']);
    assert.deepEqual(player.played.map((clip) => clip.length), [bytesFor('fine')]);
  });

  it('drops everything and refuses new messages once closed', async () => {
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ engine: fakeEngine(), player, maxLength: 5, logger: silentLogger });
    queue.enqueue({ text: 'a', sid: 0 });
    queue.enqueue({ text: 'b', sid: 0 });
    await flush();
    queue.close();
    assert.equal(queue.size, 0);
    assert.equal(player.stops, 1);
    assert.equal(queue.enqueue({ text: 'c', sid: 0 }), false);
  });
});
