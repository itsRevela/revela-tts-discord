import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimatedWaitSeconds, type BufferState } from '../../src/playback/playbackBuffer.ts';
import { speechStatus } from '../../src/playback/speechStatus.ts';

// 100 characters at 0.1 s each: 10 s of audio. At 0.5x the wait from the start is 10 * (2 - 1) * 1.2 = 12 s.
const buffer: BufferState = {
  synthesized: false,
  chunks: 0,
  elapsedSeconds: 0,
  receivedSeconds: 0,
  textLength: 100,
  historicalRate: 0.5,
  secondsPerCharacter: 0.1,
};

describe('speechStatus', () => {
  it('reports playing and queued messages as such', () => {
    assert.deepEqual(speechStatus({ playing: true, pending: false, ahead: 0, buffer }), { stage: 'playing' });
    assert.deepEqual(speechStatus({ playing: false, pending: true, ahead: 2, buffer }), { stage: 'queued', ahead: 2 });
  });

  it('estimates progress from the model history before any audio arrives', () => {
    assert.ok(Math.abs((estimatedWaitSeconds(buffer) ?? 0) - 12) < 1e-9);
    const status = speechStatus({ playing: false, pending: false, ahead: 0, buffer: { ...buffer, elapsedSeconds: 3 } });
    assert.equal(status.stage, 'generating');
    assert.ok(status.stage === 'generating' && Math.abs((status.progress ?? 0) - 0.25) < 1e-9);
    assert.ok(status.stage === 'generating' && Math.abs((status.secondsLeft ?? 0) - 9) < 1e-9);
  });

  it('has no estimate for a model it knows nothing about', () => {
    const status = speechStatus({ playing: false, pending: false, ahead: 0, buffer: { ...buffer, historicalRate: undefined } });
    assert.deepEqual(status, { stage: 'generating', ahead: 0, progress: undefined, secondsLeft: undefined });
  });

  it('is ready once playable, waiting only if messages are ahead', () => {
    const done = { ...buffer, synthesized: true, chunks: 4 };
    assert.deepEqual(speechStatus({ playing: false, pending: false, ahead: 1, buffer: done }), { stage: 'ready', ahead: 1 });
    assert.deepEqual(speechStatus({ playing: false, pending: false, ahead: 0, buffer: done }), {
      stage: 'generating',
      ahead: 0,
      progress: 1,
      secondsLeft: 0,
    });
  });
});
