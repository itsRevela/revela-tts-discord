import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pocketConfig } from '../../../../src/tts/models/pocket/config.ts';

const dir = '/models/pocket';
const file = (name: string): string => path.join(dir, name);

describe('pocketConfig', () => {
  it('uses the fp32 weights', () => {
    const pocket = pocketConfig({ modelDir: dir, variant: 'fp32', numThreads: 4, voiceCount: 26 }).model.pocket;
    assert.ok(pocket);
    assert.equal(pocket.lmMain, file('lm_main.onnx'));
    assert.equal(pocket.lmFlow, file('lm_flow.onnx'));
    assert.equal(pocket.decoder, file('decoder.onnx'));
    assert.equal(pocket.encoder, file('encoder.onnx'));
    assert.equal(pocket.voiceEmbeddingCacheCapacity, 26);
  });

  it('switches only the quantized files for int8', () => {
    const pocket = pocketConfig({ modelDir: dir, variant: 'int8', numThreads: 4, voiceCount: 1 }).model.pocket;
    assert.ok(pocket);
    assert.equal(pocket.lmMain, file('lm_main.int8.onnx'));
    assert.equal(pocket.lmFlow, file('lm_flow.int8.onnx'));
    assert.equal(pocket.decoder, file('decoder.int8.onnx'));
    assert.equal(pocket.encoder, file('encoder.onnx'));
    assert.equal(pocket.textConditioner, file('text_conditioner.onnx'));
  });

  it('runs on CPU with the configured threads', () => {
    const config = pocketConfig({ modelDir: dir, variant: 'fp32', numThreads: 6, voiceCount: 1 });
    assert.equal(config.model.provider, 'cpu');
    assert.equal(config.model.numThreads, 6);
  });
});
