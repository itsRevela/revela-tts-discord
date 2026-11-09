import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_NAME_LENGTH, speakableName } from '../../src/text/speakableName.ts';

describe('speakableName', () => {
  it('keeps ordinary names', () => {
    assert.equal(speakableName('Alex'), 'Alex');
    assert.equal(speakableName("O'Brien-Smith"), "O'Brien-Smith");
  });

  it('drops emoji and symbols, and splits on underscores and dots', () => {
    assert.equal(speakableName('✨ xX_Gamer.Pro_Xx ✨'), 'xX Gamer Pro Xx');
  });

  it('folds decorative unicode letters', () => {
    assert.equal(speakableName('𝔸𝕝𝕖𝕩'), 'Alex');
  });

  it('caps the length', () => {
    assert.equal(speakableName('a'.repeat(100))?.length, MAX_NAME_LENGTH);
  });

  it('returns undefined when nothing pronounceable is left', () => {
    assert.equal(speakableName('🔥🔥'), undefined);
    assert.equal(speakableName(''), undefined);
    assert.equal(speakableName(null), undefined);
  });
});
