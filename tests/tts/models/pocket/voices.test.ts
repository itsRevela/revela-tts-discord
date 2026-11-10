import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pocketModel } from '../../../../src/tts/models/pocket/index.ts';
import { DEFAULT_POCKET_VOICE_ID, POCKET_VOICES, pocketVoices } from '../../../../src/tts/models/pocket/voices.ts';

describe('Pocket voice catalog', () => {
  it("lists Kyutai's 21 English voices with unique ids, Alba first", () => {
    assert.equal(POCKET_VOICES.length, 21);
    assert.equal(new Set(POCKET_VOICES.map((voice) => voice.id)).size, 21);
    assert.equal(POCKET_VOICES[0]?.id, DEFAULT_POCKET_VOICE_ID);
    assert.equal(pocketModel.defaultVoiceId, 'alba');
    assert.equal(pocketModel.remote, true);
  });

  it('names voices for people, marks the default and records a licence', () => {
    const byId = new Map(POCKET_VOICES.map((voice) => [voice.id, voice]));
    assert.equal(byId.get('alba')?.label, "Alba (Kyutai's default)");
    assert.equal(byId.get('peter_yearsley')?.label, 'Peter Yearsley');
    assert.ok(POCKET_VOICES.every((voice) => ['CC BY 4.0', 'CC0', 'CC BY-NC 4.0'].includes(voice.license)));
  });
});

describe('pocketVoices', () => {
  it("keeps catalog order for the server's voices, names new ones, then lists custom voices", () => {
    const voices = pocketVoices({ voices: ['marius', 'default', 'alba', 'newcomer'], custom: ['Tony Balogna', 'rekp'] });
    assert.deepEqual(
      voices.map(({ id, serverName, label, custom }) => ({ id, serverName, label, custom })),
      [
        { id: 'alba', serverName: 'alba', label: "Alba (Kyutai's default)", custom: undefined },
        { id: 'marius', serverName: 'marius', label: 'Marius', custom: undefined },
        { id: 'newcomer', serverName: 'newcomer', label: 'Newcomer', custom: undefined },
        { id: 'custom:tony_balogna', serverName: 'Tony Balogna', label: 'Tony Balogna', custom: true },
        { id: 'custom:rekp', serverName: 'rekp', label: 'rekp', custom: true },
      ],
    );
    assert.ok(voices.every((voice) => !('license' in voice)));
  });
});
