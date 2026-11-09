import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import { loadInBackground } from '../../src/tts/backgroundModels.ts';
import type { LoadedModel } from '../../src/tts/modelCatalog.ts';
import type { TtsModel } from '../../src/tts/types.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const options = { modelsDir: '/m', customVoicesDir: '/v', numThreads: 1, speed: 1, env: {}, logger: silentLogger };

function flakyModel(failures: number): TtsModel & { attempts: number } {
  const model = {
    attempts: 0,
    id: 'phonon',
    name: 'Phonon',
    description: 'test',
    voices: [],
    defaultVoiceId: 'default',
    remote: true,
    load: async () => {
      model.attempts += 1;
      if (model.attempts <= failures) throw new Error('server not ready');
      return { voices: [{ id: 'Zoey', label: 'Zoey' }], synthesize: async () => undefined };
    },
  };
  return model;
}

describe('loadInBackground', () => {
  it('retries until the model loads, then hands it over once', async () => {
    const model = flakyModel(2);
    const loaded: LoadedModel[] = [];
    loadInBackground([model], options, (ready) => loaded.push(ready), 10);
    await wait(80);
    assert.equal(model.attempts, 3);
    assert.deepEqual(loaded.map((ready) => ready.id), ['phonon']);
    assert.equal(loaded[0]?.voices.length, 1);
  });

  it('stops retrying when stopped', async () => {
    const model = flakyModel(1000);
    const background = loadInBackground([model], options, () => assert.fail('should not load'), 10);
    await wait(35);
    background.stop();
    const attempts = model.attempts;
    await wait(40);
    assert.equal(model.attempts, attempts);
  });
});
