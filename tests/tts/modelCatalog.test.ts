import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { loadedModel, testCatalog } from '../helpers/catalog.ts';

describe('createModelCatalog', () => {
  const catalog = testCatalog();

  it('finds models and their voices', () => {
    assert.equal(catalog.defaultModelId, 'pocket');
    assert.equal(catalog.findModel('kokoro')?.name, 'Kokoro');
    assert.equal(catalog.findModel('nope'), undefined);
    assert.equal(catalog.findVoice('kokoro', 'af_heart')?.id, 'af_heart');
    assert.equal(catalog.findVoice('pocket', 'af_heart'), undefined);
  });

  it('needs at least one model', () => {
    assert.throws(() => createModelCatalog([], 'pocket'), /No TTS model loaded/);
  });

  it('lets the first loaded model stand in until the default joins', () => {
    const catalog = createModelCatalog(
      [loadedModel('pocket', 'Pocket', [], 'alba'), loadedModel('kokoro', 'Kokoro', [], 'af_heart')],
      'phonon',
      ['pocket', 'kokoro', 'phonon'],
    );
    assert.equal(catalog.defaultModelId, 'pocket');
    catalog.add(loadedModel('phonon', 'Phonon', [{ id: 'Harper', label: 'Harper' }], 'Harper'));
    assert.equal(catalog.defaultModelId, 'phonon');
  });

  it('lets models join later, in configured order', () => {
    const grown = createModelCatalog([loadedModel('pocket', 'Pocket', [], 'alba')], 'pocket', ['pocket', 'kokoro', 'phonon']);
    grown.add(loadedModel('phonon', 'Phonon', [{ id: 'Zoey', label: 'Zoey' }], 'default'));
    grown.add(loadedModel('kokoro', 'Kokoro', [], 'af_heart'));
    assert.deepEqual(grown.models.map((model) => model.id), ['pocket', 'kokoro', 'phonon']);
    assert.equal(grown.findVoice('phonon', 'Zoey')?.label, 'Zoey');
    grown.add(loadedModel('phonon', 'Phonon', [], 'default'));
    assert.equal(grown.models.length, 3);
    assert.equal(grown.findVoice('phonon', 'Zoey'), undefined);
  });
});
