/** Discord voice expects 48 kHz, 16-bit little-endian, interleaved stereo PCM. */
export const DISCORD_SAMPLE_RATE = 48_000;
const BYTES_PER_FRAME = 4; // 2 channels x 2 bytes

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return Math.round(clamped * 32767);
}

/**
 * Converts mono float samples at any rate to Discord's PCM format, resampling
 * with linear interpolation and duplicating the channel.
 */
export function toDiscordPcm(samples: Float32Array, sampleRate: number): Buffer {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`);
  }
  const step = sampleRate / DISCORD_SAMPLE_RATE;
  const frames = Math.floor(samples.length / step);
  const output = Buffer.alloc(frames * BYTES_PER_FRAME);
  for (let frame = 0; frame < frames; frame += 1) {
    const position = frame * step;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = samples[index] ?? 0;
    const next = samples[index + 1] ?? current;
    const value = toInt16(current + (next - current) * fraction);
    const offset = frame * BYTES_PER_FRAME;
    output.writeInt16LE(value, offset);
    output.writeInt16LE(value, offset + 2);
  }
  return output;
}
