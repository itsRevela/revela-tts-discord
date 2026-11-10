import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { silentLogger, type Logger } from '../../src/logging/logger.ts';
import { ProductionRates } from '../../src/playback/playbackBuffer.ts';
import { SpeechQueue, type SpeechRequest } from '../../src/playback/speechQueue.ts';
import type { SpeechStatus } from '../../src/playback/speechStatus.ts';
import type { ModelSynthesisRequest, Synthesizer } from '../../src/tts/synthesizer.ts';
import { bytesOf, fakePlayer, fakeSynthesizer, flush } from '../helpers/fakes.ts';

/** Fake chunks hold 10 samples per character at 24 kHz: 20 frames at 48 kHz, 4 bytes per stereo frame. */
const bytesFor = (text: string): number => text.replace(/\|/g, '').length * 10 * 2 * 4;

const say = (text: string, model = 'pocket', voiceId = 'alba'): SpeechRequest => ({ text, model, voiceId });

/** Both test models are known to be fast, so playback starts on the first chunk. */
function fastRates(): ProductionRates {
  const rates = new ProductionRates();
  rates.record('pocket', 3);
  rates.record('kokoro', 3);
  return rates;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SpeechQueue', () => {
  it('plays each message as one continuous stream, in order', async () => {
    const synthesizer = fakeSynthesizer();
    const player = fakePlayer();
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(say('one|three'));
    queue.enqueue(say('seventeen', 'kokoro', 'af_heart'));
    await settle();
    assert.deepEqual(player.played.map(bytesOf), [bytesFor('one|three'), bytesFor('seventeen')]);
    assert.ok(player.played.every((message) => message.ended));
    assert.deepEqual(
      synthesizer.requests.map(({ model, voiceId }) => `${model}/${voiceId}`),
      ['pocket/alba', 'kokoro/af_heart'],
    );
    assert.equal(queue.size, 0);
  });

  it('starts playing before the rest of the message is synthesized, then streams it in', async () => {
    const synthesizer = fakeSynthesizer();
    const gate = deferred();
    synthesizer.gate = gate.promise;
    const player = fakePlayer();
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(say('first|second'));
    await settle();
    assert.equal(player.played.length, 1);
    assert.equal(bytesOf(player.played[0]), bytesFor('first'));
    assert.equal(player.played[0]?.ended, false);

    gate.resolve();
    await settle();
    assert.equal(player.played.length, 1);
    assert.equal(bytesOf(player.played[0]), bytesFor('firstsecond'));
    assert.equal(player.played[0]?.ended, true);
  });

  it('refuses messages beyond the maximum length', () => {
    const queue = new SpeechQueue({ synthesizer: fakeSynthesizer(), player: fakePlayer(false), maxLength: 2, logger: silentLogger });
    assert.equal(queue.enqueue(say('a')), true);
    assert.equal(queue.enqueue(say('b')), true);
    assert.equal(queue.isFull, true);
    assert.equal(queue.enqueue(say('c')), false);
  });

  it('skips the current message, cancels its synthesis and moves on', async () => {
    const synthesizer = fakeSynthesizer();
    const gate = deferred();
    synthesizer.gate = gate.promise;
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(say('long|message|here'));
    queue.enqueue(say('next'));
    await settle();
    assert.equal(player.played.length, 1);

    assert.equal(queue.skip(), true);
    assert.equal(player.stops, 1);
    assert.equal(synthesizer.requests[0]?.signal?.aborted, true);
    synthesizer.gate = undefined;
    gate.resolve();
    await settle();
    assert.equal(player.played.length, 2);
    assert.equal(bytesOf(player.played[1]), bytesFor('next'));
    player.finishCurrent();
    await settle();
    assert.equal(queue.size, 0);
  });

  it('reports nothing to skip when empty', () => {
    const queue = new SpeechQueue({ synthesizer: fakeSynthesizer(), player: fakePlayer(), maxLength: 5, logger: silentLogger, rates: fastRates() });
    assert.equal(queue.skip(), false);
  });

  it('logs a failed synthesis and continues with the next message', async () => {
    const errors: string[] = [];
    const logger: Logger = { ...silentLogger, error: (message) => errors.push(message) };
    const synthesizer = fakeSynthesizer();
    synthesizer.failNext = true;
    const player = fakePlayer();
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger, rates: fastRates() });
    queue.enqueue(say('broken'));
    queue.enqueue(say('fine'));
    await settle();
    assert.deepEqual(errors, ['Speech synthesis failed']);
    assert.deepEqual(player.played.map(bytesOf), [bytesFor('fine')]);
  });

  it('reports each message done exactly once: played, failed, skipped, or dropped on close', async () => {
    const done: string[] = [];
    const tracked = (text: string): SpeechRequest => ({ ...say(text), onDone: () => done.push(text) });
    const synthesizer = fakeSynthesizer();
    synthesizer.failNext = true;
    const player = fakePlayer();
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(tracked('broken'));
    queue.enqueue(tracked('played'));
    await settle();
    assert.deepEqual(done, ['broken', 'played']);

    const gate = deferred();
    synthesizer.gate = gate.promise;
    const held = new SpeechQueue({ synthesizer, player: fakePlayer(false), maxLength: 5, logger: silentLogger, rates: fastRates() });
    held.enqueue(tracked('skipped|rest'));
    held.enqueue(tracked('waiting'));
    await settle();
    held.skip();
    held.close();
    held.close();
    gate.resolve();
    await settle();
    assert.deepEqual(done, ['broken', 'played', 'skipped|rest', 'waiting']);
  });

  it('reports where each message stands until it starts playing', async () => {
    const stages: string[] = [];
    const describeStatus = (status: SpeechStatus): string => ('ahead' in status ? `${status.stage}/${status.ahead}` : status.stage);
    const watched = (text: string, label: string): SpeechRequest => ({
      ...say(text),
      onStatus: (status) => stages.push(`${label}:${describeStatus(status)}`),
    });
    const synthesizer = fakeSynthesizer();
    const gate = deferred();
    synthesizer.gate = gate.promise;
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(watched('first|rest', 'a'));
    queue.enqueue(watched('second', 'b'));
    await settle();
    assert.ok(stages.includes('a:playing'));
    assert.ok(stages.includes('b:queued/1'));
    assert.ok(!stages.includes('b:playing'));
    gate.resolve();
    await settle();
    assert.ok(stages.includes('b:ready/1'), 'generated while the first message plays');
    player.finishCurrent();
    await settle();
    assert.equal(stages.at(-1), 'b:playing');
    queue.close();
  });

  it('drops one author\'s messages when they leave, stopping theirs if it is playing', async () => {
    const done: string[] = [];
    const from = (authorId: string, text: string): SpeechRequest => ({ ...say(text), authorId, onDone: () => done.push(text) });
    const synthesizer = fakeSynthesizer();
    const gate = deferred();
    synthesizer.gate = gate.promise;
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(from('leaver', 'playing|now'));
    queue.enqueue(from('stayer', 'kept'));
    queue.enqueue(from('leaver', 'queued'));
    await settle();
    assert.equal(player.played.length, 1);

    assert.equal(queue.dropAuthor('leaver'), 2);
    assert.equal(player.stops, 1);
    assert.deepEqual(done, ['playing|now', 'queued']);
    assert.equal(queue.size, 1);
    assert.equal(queue.dropAuthor('nobody'), 0);
    assert.equal(player.stops, 1, 'nothing else stopped');
    synthesizer.gate = undefined;
    gate.resolve();
    await settle();
    assert.equal(bytesOf(player.played.at(-1)), bytesFor('kept'));
    queue.close();
  });

  it('drops everything and refuses new messages once closed', async () => {
    const player = fakePlayer(false);
    const queue = new SpeechQueue({ synthesizer: fakeSynthesizer(), player, maxLength: 5, logger: silentLogger, rates: fastRates() });
    queue.enqueue(say('a'));
    queue.enqueue(say('b'));
    await settle();
    queue.close();
    assert.equal(queue.size, 0);
    assert.equal(player.stops, 1);
    assert.equal(queue.enqueue(say('c')), false);
  });
});

/** A synthesizer whose chunks the test releases one by one, with their length in seconds. */
function manualSynthesizer(): Synthesizer & { emit(seconds: number): void; finish(): void } {
  let current: ModelSynthesisRequest | undefined;
  let done: (() => void) | undefined;
  return {
    synthesize: (request) => new Promise<void>((resolve) => {
      current = request;
      done = resolve;
    }),
    emit: (seconds) => current?.onChunk({ samples: new Float32Array(Math.round(seconds * 24_000)), sampleRate: 24_000 }),
    finish: () => done?.(),
  };
}

describe('SpeechQueue buffering for models slower than real time', () => {
  const text = 'x'.repeat(100); // 10 s of audio at the paces used below

  it('waits until the rest can be generated within the playing time, rechecking on a timer', async () => {
    const synthesizer = manualSynthesizer();
    const player = fakePlayer(false);
    const rates = new ProductionRates();
    rates.record('neutts', 0.5);
    rates.recordPace('neutts', 'jo', 0.1); // wait 10 * (1 / 0.5 - 1) * 1.2 = 12 s from the start
    let clock = 0;
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates, now: () => clock });
    queue.enqueue(say(text, 'neutts', 'jo'));
    await settle();
    for (let step = 0; step < 6; step += 1) {
      synthesizer.emit(1);
      await settle();
      clock += 2; // one second of audio every two seconds
    }
    assert.equal(player.played.length, 0, 'not yet at 10 s');
    // No chunk arrives (like a pause between pieces); the timer still starts playback once 12 s have passed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(player.played.length, 1, 'starts at 12 s');
    assert.equal(bytesOf(player.played[0]), 6 * 48_000 * 4);
    queue.close();
  });

  it('starts a fast model on its first chunk', async () => {
    const synthesizer = manualSynthesizer();
    const player = fakePlayer(false);
    const rates = new ProductionRates();
    rates.record('phonon', 7);
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates });
    queue.enqueue(say(text, 'phonon', 'Zoey'));
    await settle();
    synthesizer.emit(0.1);
    await settle();
    assert.equal(player.played.length, 1);
  });

  it('measures an unknown model as audio arrives, and remembers its rate and pace', async () => {
    const synthesizer = manualSynthesizer();
    const player = fakePlayer(false);
    const rates = new ProductionRates();
    let clock = 0;
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates, now: () => clock });
    queue.enqueue(say('short', 'newmodel', 'v'));
    await settle();
    synthesizer.emit(0.5);
    await settle();
    assert.equal(player.played.length, 0, 'no time has passed, so no rate yet');
    clock += 0.25;
    synthesizer.emit(0.5); // 1 s of audio in 0.25 s: four times real time
    await settle();
    assert.equal(player.played.length, 1);
    synthesizer.finish();
    await settle();
    assert.equal(rates.get('newmodel'), 4);
    assert.equal(rates.pace('newmodel', 'v'), 1 / 'short'.length);
  });

  it('plays whatever arrived once synthesis finishes, however little', async () => {
    const synthesizer = manualSynthesizer();
    const player = fakePlayer(false);
    const rates = new ProductionRates();
    rates.record('neutts', 0.2);
    const queue = new SpeechQueue({ synthesizer, player, maxLength: 5, logger: silentLogger, rates });
    queue.enqueue(say(text, 'neutts', 'jo'));
    await settle();
    synthesizer.emit(0.5);
    await settle();
    assert.equal(player.played.length, 0);
    synthesizer.finish();
    await settle();
    assert.equal(player.played.length, 1);
    queue.close();
  });
});
