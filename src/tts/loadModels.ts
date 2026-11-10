import path from 'node:path';
import type { Logger } from '../logging/logger.ts';
import type { LoadedModel } from './modelCatalog.ts';
import type { TtsEngine, TtsModel } from './types.ts';

export interface LoadModelsOptions {
  /** Each model loads from <modelsDir>/<model id>. */
  readonly modelsDir: string;
  readonly numThreads: number;
  readonly speed: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Models the bot cannot run without; any other model that fails to load is skipped with an error. */
  readonly required: readonly string[];
  readonly logger: Logger;
}

/**
 * Loads models one after another (they share the CPU) and logs how long each
 * took. A model that fails to load (say, a server that is down) is skipped
 * unless it is required.
 */
export async function loadModels(models: readonly TtsModel[], options: LoadModelsOptions): Promise<readonly LoadedModel[]> {
  const { modelsDir, numThreads, speed, env, required, logger } = options;
  const loaded: LoadedModel[] = [];
  for (const model of models) {
    const started = performance.now();
    let engine: TtsEngine;
    try {
      engine = await model.load({
        modelDir: path.join(modelsDir, model.id),
        numThreads,
        speed,
        env,
        logger,
      });
    } catch (error: unknown) {
      if (required.includes(model.id)) throw error;
      logger.error('Model failed to load; continuing without it', { model: model.id, error });
      continue;
    }
    logger.info('Model loaded', { model: model.id, voices: engine.voices.length, ms: Math.round(performance.now() - started) });
    loaded.push({
      id: model.id,
      name: model.name,
      description: model.description,
      voices: engine.voices,
      defaultVoiceId: model.defaultVoiceId,
      engine,
    });
  }
  return loaded;
}
