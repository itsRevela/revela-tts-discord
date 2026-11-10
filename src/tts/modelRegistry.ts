import { kokoroModel } from './models/kokoro/index.ts';
import { neuttsModel } from './models/neutts/index.ts';
import { phononModel } from './models/phonon/index.ts';
import { pocketModel } from './models/pocket/index.ts';
import type { TtsModel } from './types.ts';

/**
 * Every model the bot knows. To add one, create src/tts/models/<id>/ with an
 * index.ts exporting a TtsModel, list it here, and add its files to the image.
 */
/** Also the default TTS_MODELS order, which is the order /voice lists models in: highest quality first. */
export const MODELS: readonly TtsModel[] = [phononModel, pocketModel, neuttsModel, kokoroModel];

export const MODEL_IDS: readonly string[] = MODELS.map((model) => model.id);

export function findModelDefinition(id: string): TtsModel | undefined {
  return MODELS.find((model) => model.id === id);
}
