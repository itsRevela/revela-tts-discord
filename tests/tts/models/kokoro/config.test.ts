import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { kokoroConfig } from '../../../../src/tts/models/kokoro/config.ts';

describe('kokoroConfig', () => {
  const config = kokoroConfig({ modelDir: '/models/kokoro', numThreads: 4 });

  it('points at the fp32 model with the English and Chinese text frontends', () => {
    const kokoro = config.model.kokoro;
    assert.ok(kokoro);
    assert.equal(kokoro.model, path.join('/models/kokoro', 'model.onnx'));
    assert.equal(kokoro.voices, path.join('/models/kokoro', 'voices.bin'));
    assert.equal(kokoro.tokens, path.join('/models/kokoro', 'tokens.txt'));
    assert.equal(kokoro.lexicon, `${path.join('/models/kokoro', 'lexicon-us-en.txt')},${path.join('/models/kokoro', 'lexicon-zh.txt')}`);
    assert.equal(kokoro.dataDir, path.join('/models/kokoro', 'espeak-ng-data'));
    assert.equal(kokoro.dictDir, path.join('/models/kokoro', 'dict'));
    assert.equal(kokoro.lang, undefined);
    assert.equal(config.ruleFsts?.split(',').length, 3);
  });

  it('runs on CPU with the configured threads, one sentence per chunk', () => {
    assert.equal(config.model.provider, 'cpu');
    assert.equal(config.model.numThreads, 4);
    assert.equal(config.maxNumSentences, 1);
  });
});
