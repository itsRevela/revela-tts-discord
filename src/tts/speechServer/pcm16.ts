/** The speech servers stream headerless 16-bit little-endian mono PCM at 24 kHz. */
export const SPEECH_SERVER_SAMPLE_RATE = 24_000;

/**
 * Turns a byte stream of 16-bit samples into float samples, carrying a byte
 * that lands at the end of one network chunk over to the next.
 */
export function createPcm16Decoder(): (bytes: Uint8Array) => Float32Array {
  let carry: Uint8Array = new Uint8Array(0);
  return (bytes) => {
    const joined = carry.length > 0 ? Buffer.concat([carry, bytes]) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const usable = joined.length - (joined.length % 2);
    carry = Uint8Array.from(joined.subarray(usable));
    const samples = new Float32Array(usable / 2);
    for (let i = 0; i < samples.length; i += 1) samples[i] = joined.readInt16LE(i * 2) / 32768;
    return samples;
  };
}
