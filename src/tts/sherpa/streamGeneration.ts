import type { OfflineTts, TtsAsyncRequest } from 'sherpa-onnx-node';
import type { SpeechChunk } from '../types.ts';

/** What a model passes to sherpa, minus the progress callback this helper owns. */
export type GenerationParams = Omit<TtsAsyncRequest, 'onProgress'>;

/**
 * Runs sherpa-onnx generation off the main thread, forwarding each chunk as
 * it is produced and stopping early once `signal` aborts.
 */
export async function streamGeneration(
  tts: OfflineTts,
  params: GenerationParams,
  onChunk: (chunk: SpeechChunk) => void,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) return;
  let emitted = false;
  const audio = await tts.generateAsync({
    ...params,
    onProgress: (info) => {
      if (signal?.aborted) return 0;
      emitted = true;
      onChunk({ samples: info.samples, sampleRate: tts.sampleRate });
      return signal?.aborted ? 0 : 1;
    },
  });
  // Defensive: if no progress callback fired, deliver the whole result at once.
  if (!emitted && !signal?.aborted && audio.samples.length > 0) {
    onChunk({ samples: audio.samples, sampleRate: audio.sampleRate });
  }
}
