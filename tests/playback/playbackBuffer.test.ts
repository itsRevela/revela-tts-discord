import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SECONDS_PER_CHARACTER,
  ProductionRates,
  SAFETY_FACTOR,
  overallRate,
  planningRate,
  readyToPlay,
  remainingWaitSeconds,
  requiredWaitSeconds,
  type BufferState,
} from '../../src/playback/playbackBuffer.ts';

const base: BufferState = {
  synthesized: false,
  chunks: 3,
  elapsedSeconds: 4,
  receivedSeconds: 2,
  textLength: 100,
  historicalRate: undefined,
  secondsPerCharacter: 0.1,
};

describe('requiredWaitSeconds', () => {
  it('is zero at or above real time', () => {
    assert.equal(requiredWaitSeconds(10, 1), 0);
    assert.equal(requiredWaitSeconds(10, 7), 0);
  });

  it('is total * (1 / rate - 1) with a safety margin below real time', () => {
    assert.ok(Math.abs(requiredWaitSeconds(10, 0.5) - 10 * SAFETY_FACTOR) < 1e-9);
  });
});

describe('planning and readiness', () => {
  it('plays a finished message and never one without audio', () => {
    assert.equal(readyToPlay({ ...base, synthesized: true, chunks: 0 }), true);
    assert.equal(remainingWaitSeconds({ ...base, chunks: 0 }), undefined);
  });

  it('uses the more cautious of this message and the model history', () => {
    assert.equal(planningRate(base), 0.5);
    assert.equal(planningRate({ ...base, historicalRate: 0.3 }), 0.3);
    assert.equal(planningRate({ ...base, historicalRate: 5 }), 0.5);
  });

  it('starts fast models on their first chunk', () => {
    assert.equal(readyToPlay({ ...base, chunks: 1, elapsedSeconds: 0.5, receivedSeconds: 2 }), true);
  });

  it('waits until generation can finish within the playing time', () => {
    // 10 s of audio at 0.5x needs 10 * (2 - 1) * 1.2 = 12 s from the start.
    assert.ok(Math.abs((remainingWaitSeconds(base) ?? 0) - 8) < 1e-9);
    assert.equal(readyToPlay({ ...base, elapsedSeconds: 12, receivedSeconds: 6 }), true);
  });

  it('measures the overall rate from the start of synthesis', () => {
    assert.equal(overallRate(3, 6), 0.5);
    assert.equal(overallRate(3, 0), undefined);
  });
});

/** Seconds of audio produced by time t: a startup pause, then pieces at `rate` with a pause between each. */
function burstyProduction(pieceSeconds: number[], pause: number, rate: number): (t: number) => number {
  return (t) => {
    let clock = 0;
    let produced = 0;
    for (const piece of pieceSeconds) {
      clock += pause;
      if (t <= clock) return produced;
      const generating = piece / rate;
      if (t <= clock + generating) return produced + (t - clock) * rate;
      produced += piece;
      clock += generating;
    }
    return produced;
  };
}

describe('gap-free playback with NeuTTS-style pieces', () => {
  for (const [label, pieces] of [
    ['one short piece', [8]],
    ['four long pieces', [7, 6, 7, 5]],
  ] as const) {
    it(`never runs dry: ${label}`, () => {
      const produce = burstyProduction([...pieces], 2.5, 0.72);
      const total = pieces.reduce((sum, piece) => sum + piece, 0);
      const textLength = Math.round(total / 0.1);
      let start: number | undefined;
      for (let t = 0.1; t < 200 && start === undefined; t += 0.05) {
        const received = produce(t);
        const state: BufferState = {
          synthesized: received >= total,
          chunks: Math.floor(received / 0.5),
          elapsedSeconds: t,
          receivedSeconds: received,
          textLength,
          historicalRate: undefined,
          secondsPerCharacter: 0.1,
        };
        if (readyToPlay(state)) start = t;
      }
      assert.ok(start !== undefined);
      for (let t = start; t < start + total; t += 0.05) {
        assert.ok(t - start <= produce(t) + 1e-6, `ran dry at ${t.toFixed(2)} s`);
      }
    });
  }
});

describe('ProductionRates', () => {
  it('learns speaking pace per voice, falling back to the model', () => {
    const rates = new ProductionRates();
    rates.recordPace('neutts', 'custom:rekp', 0.124);
    assert.equal(rates.pace('neutts', 'custom:rekp'), 0.124);
    assert.equal(rates.pace('neutts', 'jo'), 0.124);
    rates.recordPace('neutts', 'jo', 0.1);
    assert.equal(rates.pace('neutts', 'jo'), 0.1);
    assert.equal(rates.pace('kokoro', 'af_heart'), undefined);
  });

  it('smooths each model rate separately and ignores nonsense', () => {
    const rates = new ProductionRates();
    rates.record('neutts', 0.6);
    rates.record('neutts', 0.8);
    rates.record('neutts', 0);
    rates.record('phonon', 7);
    assert.ok(Math.abs((rates.get('neutts') ?? 0) - 0.7) < 1e-9);
    assert.equal(rates.get('phonon'), 7);
    assert.equal(DEFAULT_SECONDS_PER_CHARACTER, 0.13);
  });
});
