import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preferenceDefaultsFor } from '../../src/preferences/catalogDefaults.ts';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { loadedModel, testCatalog } from '../helpers/catalog.ts';

describe('preferenceDefaultsFor', () => {
  it('falls back to the default model for unknown or unloaded models', () => {
    const defaults = preferenceDefaultsFor(testCatalog(), undefined);
    assert.equal(defaults.resolveModel(undefined), 'pocket');
    assert.equal(defaults.resolveModel('kokoro'), 'kokoro');
    assert.equal(defaults.resolveModel('retired'), 'pocket');
  });

  it('keeps available voices and falls back to the model default otherwise', () => {
    const defaults = preferenceDefaultsFor(testCatalog(), undefined);
    assert.equal(defaults.resolveVoice('pocket', 'custom:rekp', true), 'custom:rekp');
    assert.equal(defaults.resolveVoice('pocket', 'custom:deleted', true), 'alba');
    assert.equal(defaults.resolveVoice('kokoro', undefined, true), 'af_heart');
  });

  it('applies DEFAULT_VOICE to the default model only', () => {
    const defaults = preferenceDefaultsFor(testCatalog(), 'marius');
    assert.equal(defaults.resolveVoice('pocket', undefined, true), 'marius');
    assert.equal(defaults.resolveVoice('kokoro', undefined, true), 'af_heart');
  });

  it('uses the first loaded voice when the model\'s default recording is missing', () => {
    const catalog = createModelCatalog([loadedModel('pocket', 'Pocket', [{ id: 'eve', label: 'Eve' }], 'alba')], 'pocket');
    assert.equal(preferenceDefaultsFor(catalog, undefined).resolveVoice('pocket', undefined, true), 'eve');
  });

  it('gives new users Phonon with Harper once Phonon is loaded, and a stand-in before', () => {
    const catalog = createModelCatalog([loadedModel('pocket', 'Pocket TTS', [{ id: 'alba', label: 'Alba' }], 'alba')], 'phonon', [
      'pocket',
      'phonon',
    ]);
    const defaults = preferenceDefaultsFor(catalog, undefined);
    assert.equal(defaults.resolveModel(undefined), 'pocket');
    assert.equal(defaults.resolveModel('phonon'), 'pocket', 'a stored Phonon choice waits for Phonon');
    catalog.add(loadedModel('phonon', 'Phonon', [{ id: 'default', label: 'Default' }, { id: 'Harper', label: 'Harper' }], 'Harper'));
    assert.equal(defaults.resolveModel(undefined), 'phonon');
    assert.equal(defaults.resolveVoice('phonon', undefined, true), 'Harper');
  });
});
