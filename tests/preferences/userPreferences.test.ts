import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseStoredPreferences,
  resolvePreferences,
  withPreference,
} from '../../src/preferences/userPreferences.ts';

const DEFAULTS = { voice: 'af_heart', announceName: true };
const ALEX = '300000000000000001';

describe('resolvePreferences', () => {
  it('uses defaults for users who changed nothing', () => {
    assert.deepEqual(resolvePreferences({}, ALEX, DEFAULTS), DEFAULTS);
  });

  it('overlays only the values a user changed', () => {
    const stored = { [ALEX]: { announceName: false } };
    assert.deepEqual(resolvePreferences(stored, ALEX, DEFAULTS), { voice: 'af_heart', announceName: false });
  });

  it('ignores a stored voice that no longer exists', () => {
    const stored = { [ALEX]: { voice: 'retired_voice' } };
    assert.equal(resolvePreferences(stored, ALEX, DEFAULTS).voice, 'af_heart');
  });
});

describe('withPreference', () => {
  it('merges a patch without mutating the original', () => {
    const original = { [ALEX]: { voice: 'bm_george' } };
    const next = withPreference(original, ALEX, { announceName: false });
    assert.deepEqual(next[ALEX], { voice: 'bm_george', announceName: false });
    assert.deepEqual(original[ALEX], { voice: 'bm_george' });
  });
});

describe('parseStoredPreferences', () => {
  it('keeps valid entries and counts invalid ones', () => {
    const parsed = parseStoredPreferences({
      [ALEX]: { voice: 'bm_george', announceName: false },
      '300000000000000002': { voice: 'not_a_voice' },
      '300000000000000003': { announceName: 'yes' },
      'not-a-user-id': { announceName: true },
    });
    assert.deepEqual(parsed.preferences, { [ALEX]: { voice: 'bm_george', announceName: false } });
    assert.equal(parsed.dropped, 3);
  });

  it('rejects content that is not an object', () => {
    assert.throws(() => parseStoredPreferences([1, 2]));
    assert.throws(() => parseStoredPreferences('text'));
  });
});
