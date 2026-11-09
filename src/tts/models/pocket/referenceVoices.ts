import { access } from 'node:fs/promises';
import sherpa, { type Wave } from 'sherpa-onnx-node';
import type { Logger } from '../../../logging/logger.ts';

export interface ReferenceSource {
  readonly id: string;
  readonly file: string;
}

/**
 * Reads each voice's reference recording, resampled to the model's rate up
 * front (otherwise sherpa resamples, and logs about it, on every call).
 * Recordings that are missing or unreadable are skipped with a warning.
 */
export async function loadReferenceVoices(
  sources: readonly ReferenceSource[],
  targetSampleRate: number,
  logger: Logger,
): Promise<ReadonlyMap<string, Wave>> {
  const loaded = await Promise.all(
    sources.map(async ({ id, file }): Promise<readonly [string, Wave] | undefined> => {
      try {
        await access(file);
        const wave = sherpa.readWave(file);
        if (wave.samples.length === 0) throw new Error('recording is empty');
        if (wave.sampleRate === targetSampleRate) return [id, wave];
        const samples = new sherpa.LinearResampler(wave.sampleRate, targetSampleRate).flush(wave.samples);
        return [id, { samples, sampleRate: targetSampleRate }];
      } catch (error: unknown) {
        logger.warn('Skipping a voice whose recording could not be read', { voice: id, file, error });
        return undefined;
      }
    }),
  );
  return new Map(loaded.filter((entry) => entry !== undefined));
}
