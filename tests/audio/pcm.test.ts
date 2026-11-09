import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCORD_SAMPLE_RATE, toDiscordPcm } from '../../src/audio/pcm.ts';

describe('toDiscordPcm', () => {
  it('upsamples 24 kHz mono to twice as many 48 kHz stereo frames', () => {
    const pcm = toDiscordPcm(new Float32Array(240), 24_000);
    assert.equal(pcm.length, 480 * 4);
  });

  it('keeps the frame count at 48 kHz', () => {
    const pcm = toDiscordPcm(new Float32Array(100), DISCORD_SAMPLE_RATE);
    assert.equal(pcm.length, 100 * 4);
  });

  it('duplicates each sample into left and right channels', () => {
    const pcm = toDiscordPcm(new Float32Array([0.5, 0.5]), 48_000);
    assert.equal(pcm.readInt16LE(0), pcm.readInt16LE(2));
    assert.equal(pcm.readInt16LE(0), Math.round(0.5 * 32767));
  });

  it('interpolates between source samples', () => {
    const pcm = toDiscordPcm(new Float32Array([0, 1]), 24_000);
    // Frame 1 sits halfway between the two source samples.
    assert.equal(pcm.readInt16LE(4), Math.round(0.5 * 32767));
  });

  it('clamps out-of-range samples', () => {
    const pcm = toDiscordPcm(new Float32Array([2, -2]), 48_000);
    assert.equal(pcm.readInt16LE(0), 32767);
    assert.equal(pcm.readInt16LE(4), -32767);
  });

  it('rejects invalid sample rates', () => {
    assert.throws(() => toDiscordPcm(new Float32Array(1), 0), RangeError);
    assert.throws(() => toDiscordPcm(new Float32Array(1), Number.NaN), RangeError);
  });
});
