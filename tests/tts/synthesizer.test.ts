import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { createSynthesizer } from '../../src/tts/synthesizer.ts';
import type { SynthesisRequest, TtsEngine } from '../../src/tts/types.ts';
import { loadedModel } from '../helpers/catalog.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function recordingEngine(name: string, events: string[], ms = 10): TtsEngine {
  return {
    voices: [{ id: 'v', label: 'V' }],
    synthesize: async (request: SynthesisRequest) => {
      events.push(`start ${name} ${request.text}`);
      await wait(ms);
      events.push(`end ${name} ${request.text}`);
    },
  };
}

describe('createSynthesizer', () => {
  it('routes each request to its model and runs one synthesis at a time across models', async () => {
    const events: string[] = [];
    const catalog = createModelCatalog(
      [
        loadedModel('pocket', 'Pocket', [], 'v', recordingEngine('pocket', events, 20)),
        loadedModel('kokoro', 'Kokoro', [], 'v', recordingEngine('kokoro', events)),
      ],
      'pocket',
    );
    const synthesizer = createSynthesizer(catalog);
    const request = (model: string, text: string) => synthesizer.synthesize({ model, text, voiceId: 'v', onChunk: () => undefined });
    await Promise.all([request('pocket', 'a'), request('kokoro', 'b')]);
    assert.deepEqual(events, ['start pocket a', 'end pocket a', 'start kokoro b', 'end kokoro b']);
  });

  it('rejects models that are not loaded', async () => {
    const synthesizer = createSynthesizer(createModelCatalog([loadedModel('pocket', 'Pocket', [], 'v')], 'pocket'));
    await assert.rejects(
      synthesizer.synthesize({ model: 'kokoro', text: 'hi', voiceId: 'v', onChunk: () => undefined }),
      /not loaded/,
    );
  });
});
