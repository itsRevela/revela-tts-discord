import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadingLine, progressBar, renderLoading } from '../../src/loading/renderLoading.ts';

const generating = { stage: 'generating', ahead: 0, progress: 0.42, secondsLeft: 9 } as const;

describe('loading line', () => {
  it('draws a ten-segment bar', () => {
    assert.equal(progressBar(0), '▱▱▱▱▱▱▱▱▱▱');
    assert.equal(progressBar(0.42), '▰▰▰▰▱▱▱▱▱▱');
    assert.equal(progressBar(2), '▰▰▰▰▰▰▰▰▰▰');
  });

  it('shows progress and time left while generating, capped below 100%', () => {
    assert.equal(
      loadingLine({ status: generating, progress: 0.42, secondsLeft: 8.2, elapsedSeconds: 6 }),
      '⏳ Generating voice ▰▰▰▰▱▱▱▱▱▱ 42% · about 9 s',
    );
    assert.equal(
      loadingLine({ status: generating, progress: 1, secondsLeft: 0.4, elapsedSeconds: 6 }),
      '⏳ Generating voice ▰▰▰▰▰▰▰▰▰▰ 99% · almost ready',
    );
  });

  it('counts seconds when there is no estimate yet', () => {
    const unknown = { stage: 'generating', ahead: 0, progress: undefined, secondsLeft: undefined } as const;
    assert.equal(
      loadingLine({ status: unknown, progress: undefined, secondsLeft: undefined, elapsedSeconds: 4.7 }),
      '⏳ Generating voice · 4 s',
    );
  });

  it('describes waiting behind other messages', () => {
    const idle = { progress: undefined, secondsLeft: undefined, elapsedSeconds: 1 };
    assert.equal(loadingLine({ ...idle, status: { stage: 'queued', ahead: 2 } }), '⏳ In line · 2 messages ahead');
    assert.equal(loadingLine({ ...idle, status: { stage: 'ready', ahead: 1 } }), '✅ Ready · plays after 1 message');
    assert.equal(
      loadingLine({ status: { ...generating, ahead: 1 }, progress: 0.5, secondsLeft: 3, elapsedSeconds: 1 }),
      '⏳ Generating voice ▰▰▰▰▰▱▱▱▱▱ 50% · plays after 1 message',
    );
  });

  it('puts the line under the reply as subtext', () => {
    assert.equal(
      renderLoading('🔊 hi', { status: { stage: 'queued', ahead: 1 }, progress: undefined, secondsLeft: undefined, elapsedSeconds: 0 }),
      '🔊 hi\n-# ⏳ In line · 1 message ahead',
    );
  });
});
