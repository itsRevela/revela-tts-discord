import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import { loadModels } from '../../src/tts/loadModels.ts';
import type { ModelLoadOptions, TtsModel } from '../../src/tts/types.ts';

function fakeModel(id: string, seen: ModelLoadOptions[]): TtsModel {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} model`,
    voices: [{ id: 'built-in', label: 'Built in' }],
    defaultVoiceId: 'built-in',
    load: async (options) => {
      seen.push(options);
      return { voices: [{ id: 'built-in', label: 'Built in' }, { id: 'custom:me', label: 'me', custom: true }], synthesize: async () => undefined };
    },
  };
}

describe('loadModels', () => {
  it('loads each model from its own folders and keeps the voices the engine reports', async () => {
    const seen: ModelLoadOptions[] = [];
    const models = await loadModels([fakeModel('pocket', seen), fakeModel('kokoro', seen)], {
      modelsDir: '/models',
      customVoicesDir: '/data/voices',
      numThreads: 3,
      speed: 1.1,
      env: { PHONON_URL: 'http://example:8880' },
      required: ['pocket'],
      logger: silentLogger,
    });
    assert.deepEqual(models.map((model) => model.id), ['pocket', 'kokoro']);
    assert.deepEqual(seen.map((options) => options.modelDir), [path.join('/models', 'pocket'), path.join('/models', 'kokoro')]);
    assert.equal(seen[0]?.customVoicesDir, path.join('/data/voices', 'pocket'));
    assert.equal(seen[0]?.numThreads, 3);
    assert.equal(models[0]?.voices.length, 2);
    assert.equal(models[0]?.name, 'POCKET');
  });

  it('skips an optional model that fails to load but not a required one', async () => {
    const broken: TtsModel = { ...fakeModel('phonon', []), load: async () => { throw new Error('server down'); } };
    const errors: string[] = [];
    const logger = { ...silentLogger, error: (message: string) => errors.push(message) };
    const base = { modelsDir: '/m', customVoicesDir: '/v', numThreads: 1, speed: 1, env: {}, logger };
    const models = await loadModels([fakeModel('pocket', []), broken], { ...base, required: ['pocket'] });
    assert.deepEqual(models.map((model) => model.id), ['pocket']);
    assert.deepEqual(errors, ['Model failed to load; continuing without it']);
    await assert.rejects(loadModels([broken], { ...base, required: ['phonon'] }), /server down/);
  });
});
