import { serialize } from '../util/serialize.ts';
import type { ModelCatalog } from './modelCatalog.ts';
import type { SynthesisRequest } from './types.ts';

export interface ModelSynthesisRequest extends SynthesisRequest {
  readonly model: string;
}

/** Routes speech to the right model. */
export interface Synthesizer {
  synthesize(request: ModelSynthesisRequest): Promise<void>;
}

/**
 * One synthesis at a time across every model: they share the same CPU
 * threads, and a single sherpa-onnx instance is not safe for concurrent use.
 */
export function createSynthesizer(catalog: ModelCatalog): Synthesizer {
  const synthesize = serialize(async ({ model, ...request }: ModelSynthesisRequest): Promise<void> => {
    const loaded = catalog.findModel(model);
    if (!loaded) throw new Error(`Model "${model}" is not loaded`);
    await loaded.engine.synthesize(request);
  });
  return { synthesize };
}
