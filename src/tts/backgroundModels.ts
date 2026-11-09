import { setTimeout as sleep } from 'node:timers/promises';
import { loadModels, type LoadModelsOptions } from './loadModels.ts';
import type { LoadedModel } from './modelCatalog.ts';
import type { TtsModel } from './types.ts';

export const BACKGROUND_RETRY_MS = 60_000;

export interface BackgroundLoading {
  /** Stops retrying; a load already in progress still finishes. */
  stop(): void;
}

/**
 * Loads each model in the background, retrying until it succeeds, and hands
 * each one to `onLoaded` when ready. Used for models served by another
 * container, so the bot can start without waiting for them.
 */
export function loadInBackground(
  models: readonly TtsModel[],
  options: Omit<LoadModelsOptions, 'required'>,
  onLoaded: (model: LoadedModel) => void,
  retryMs: number = BACKGROUND_RETRY_MS,
): BackgroundLoading {
  const controller = new AbortController();
  const { logger } = options;
  const attempt = async (model: TtsModel): Promise<void> => {
    while (!controller.signal.aborted) {
      try {
        const [loaded] = await loadModels([model], { ...options, required: [model.id] });
        if (loaded && !controller.signal.aborted) onLoaded(loaded);
        return;
      } catch (error: unknown) {
        logger.warn(`${model.name} is not available yet; retrying in ${Math.round(retryMs / 1000)} s`, { model: model.id, error });
        await sleep(retryMs, undefined, { signal: controller.signal, ref: false }).catch(() => undefined);
      }
    }
  };
  for (const model of models) void attempt(model);
  return { stop: () => controller.abort() };
}
