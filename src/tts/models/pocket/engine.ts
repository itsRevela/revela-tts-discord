import { access } from 'node:fs/promises';
import path from 'node:path';
import sherpa, { type Wave } from 'sherpa-onnx-node';
import { streamGeneration } from '../../sherpa/streamGeneration.ts';
import type { ModelLoadOptions, TtsEngine, Voice } from '../../types.ts';
import {
  POCKET_MAX_REFERENCE_SECONDS,
  POCKET_NUM_STEPS,
  POCKET_TEMPERATURE,
  pocketConfig,
  type PocketVariant,
} from './config.ts';
import { listCustomVoices } from './customVoices.ts';
import { loadReferenceVoices } from './referenceVoices.ts';
import { DEFAULT_POCKET_VOICE_ID, POCKET_VOICES, POCKET_VOICES_DIR, pocketVoiceFileName } from './voices.ts';

/** Uses whichever variant the image shipped: fp32 if its weights are present, else int8. */
async function detectVariant(modelDir: string): Promise<PocketVariant> {
  try {
    await access(path.join(modelDir, 'lm_main.onnx'));
    return 'fp32';
  } catch {
    return 'int8';
  }
}

export async function loadPocket(options: ModelLoadOptions): Promise<TtsEngine> {
  const { modelDir, customVoicesDir, numThreads, speed, logger } = options;
  const variant = await detectVariant(modelDir);
  const customVoices = await listCustomVoices(customVoicesDir);
  const tts = await sherpa.OfflineTts.createAsync(
    pocketConfig({ modelDir, variant, numThreads, voiceCount: POCKET_VOICES.length + customVoices.length }),
  );

  const catalogSources = POCKET_VOICES.map((voice) => ({
    id: voice.id,
    file: path.join(modelDir, POCKET_VOICES_DIR, pocketVoiceFileName(voice)),
  }));
  const references = await loadReferenceVoices([...catalogSources, ...customVoices], tts.sampleRate, logger);
  const voices: readonly Voice[] = [...POCKET_VOICES, ...customVoices].filter((voice) => references.has(voice.id));
  const fallback: Wave | undefined = references.get(DEFAULT_POCKET_VOICE_ID) ?? references.values().next().value;
  if (!fallback) throw new Error(`No Pocket voice recordings found in ${modelDir}`);
  logger.info('Pocket TTS ready', { variant, voices: voices.length, custom: customVoices.length });

  return {
    voices,
    synthesize: ({ text, voiceId, onChunk, signal }) => {
      const reference = references.get(voiceId) ?? fallback;
      const generationConfig = new sherpa.GenerationConfig({
        speed,
        numSteps: POCKET_NUM_STEPS,
        referenceAudio: reference.samples,
        referenceSampleRate: reference.sampleRate,
        extra: { max_reference_audio_len: POCKET_MAX_REFERENCE_SECONDS, temperature: POCKET_TEMPERATURE },
      });
      return streamGeneration(tts, { text, generationConfig }, onChunk, signal);
    },
  };
}
