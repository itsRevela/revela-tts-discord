import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoReadChannelsOf,
  parseStoredPreferences,
  resolvePreferences,
  withPreference,
  type PreferenceDefaults,
} from '../../src/preferences/userPreferences.ts';

const ALEX = '300000000000000001';
const SERVER_A = '100000000000000001';
const SERVER_B = '100000000000000002';
const CHANNEL_1 = '200000000000000001';
const CHANNEL_2 = '200000000000000002';

/** Pocket by default; knows a couple of voices per model. */
const DEFAULTS: PreferenceDefaults = {
  announceName: true,
  customVoicesLocked: false,
  resolveModel: (requested) => (requested === 'kokoro' || requested === 'pocket' ? requested : 'pocket'),
  resolveVoice: (model, requested) => {
    const known = model === 'kokoro' ? ['af_heart', 'bm_george'] : ['alba', 'custom:rekp'];
    return requested && known.includes(requested) ? requested : known[0] ?? '';
  },
};

describe('resolvePreferences', () => {
  it('uses defaults for users who changed nothing', () => {
    assert.deepEqual(resolvePreferences({}, ALEX, DEFAULTS), { model: 'pocket', voice: 'alba', announceName: true, customVoices: true });
  });

  it('uses the voice remembered for the chosen model', () => {
    const stored = { [ALEX]: { model: 'kokoro', voices: { kokoro: 'bm_george', pocket: 'custom:rekp' }, announceName: false } };
    assert.deepEqual(resolvePreferences(stored, ALEX, DEFAULTS), { model: 'kokoro', voice: 'bm_george', announceName: false, customVoices: true });
  });

  it('falls back when a stored model or voice is no longer available', () => {
    const stored = { [ALEX]: { model: 'retired', voices: { pocket: 'custom:deleted' } } };
    assert.deepEqual(resolvePreferences(stored, ALEX, DEFAULTS), { model: 'pocket', voice: 'alba', announceName: true, customVoices: true });
  });
});

describe('withPreference', () => {
  it('merges voices per model without mutating the original', () => {
    const original = { [ALEX]: { model: 'kokoro', voices: { kokoro: 'bm_george' } } };
    const next = withPreference(original, ALEX, { model: 'pocket', voices: { pocket: 'custom:rekp' } });
    assert.deepEqual(next[ALEX], { model: 'pocket', voices: { kokoro: 'bm_george', pocket: 'custom:rekp' } });
    assert.deepEqual(original[ALEX], { model: 'kokoro', voices: { kokoro: 'bm_george' } });
  });

  it('leaves voices alone when the patch has none', () => {
    const next = withPreference({ [ALEX]: { voices: { kokoro: 'af_heart' } } }, ALEX, { announceName: false });
    assert.deepEqual(next[ALEX], { voices: { kokoro: 'af_heart' }, announceName: false });
  });

  it('replaces one server\'s auto-read channels, keeps other servers, and drops empty ones', () => {
    const start = { [ALEX]: { model: 'pocket', autoRead: { [SERVER_A]: [CHANNEL_1], [SERVER_B]: [CHANNEL_2] } } };
    const added = withPreference(start, ALEX, { autoRead: { [SERVER_A]: [CHANNEL_1, CHANNEL_2] } });
    assert.deepEqual(added[ALEX]?.autoRead, { [SERVER_A]: [CHANNEL_1, CHANNEL_2], [SERVER_B]: [CHANNEL_2] });
    assert.deepEqual(autoReadChannelsOf(added, ALEX, SERVER_A), [CHANNEL_1, CHANNEL_2]);

    const cleared = withPreference(added, ALEX, { autoRead: { [SERVER_A]: [], [SERVER_B]: [] } });
    assert.deepEqual(cleared[ALEX], { model: 'pocket' });
    assert.deepEqual(autoReadChannelsOf(cleared, ALEX, SERVER_A), []);
    assert.deepEqual(start[ALEX].autoRead[SERVER_A], [CHANNEL_1], 'original untouched');
  });
});

describe('auto-read channels in the file', () => {
  it('keeps valid channel lists and drops entries with malformed ones', () => {
    const { preferences, dropped } = parseStoredPreferences({
      [ALEX]: { autoRead: { [SERVER_A]: [CHANNEL_1] } },
      '300000000000000002': { autoRead: { [SERVER_A]: ['not-a-channel'] } },
    });
    assert.deepEqual(preferences[ALEX]?.autoRead, { [SERVER_A]: [CHANNEL_1] });
    assert.equal(dropped, 1);
  });
});

describe('parseStoredPreferences', () => {
  it('keeps valid entries and counts invalid ones', () => {
    const parsed = parseStoredPreferences({
      [ALEX]: { model: 'pocket', voices: { pocket: 'alba' }, announceName: false },
      '300000000000000002': { announceName: 'yes' },
      '300000000000000003': { voices: { pocket: 5 } },
      'not-a-user-id': { announceName: true },
    });
    assert.deepEqual(parsed.preferences, { [ALEX]: { model: 'pocket', voices: { pocket: 'alba' }, announceName: false } });
    assert.equal(parsed.dropped, 3);
  });

  it('keeps people who picked a voice in the Kokoro-only version on Kokoro', () => {
    const parsed = parseStoredPreferences({ [ALEX]: { voice: 'af_bella', announceName: false } });
    assert.deepEqual(parsed.preferences[ALEX], { model: 'kokoro', voices: { kokoro: 'af_bella' }, announceName: false });
  });

  it('rejects content that is not an object', () => {
    assert.throws(() => parseStoredPreferences([1, 2]));
    assert.throws(() => parseStoredPreferences('text'));
  });
});
