import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_VOICE_ID, VOICES, findVoice, resolveVoice, searchVoices, voiceLabel } from '../../src/tts/voices.ts';

describe('voice table', () => {
  it('lists the 28 English voices with speaker ids 0-27 in model order', () => {
    assert.equal(VOICES.length, 28);
    assert.deepEqual(VOICES.map((voice) => voice.sid), [...Array(28).keys()]);
  });

  it('matches the sherpa-onnx speaker ids for known voices', () => {
    assert.equal(findVoice('af_heart')?.sid, 3);
    assert.equal(findVoice('am_adam')?.sid, 11);
    assert.equal(findVoice('bf_alice')?.sid, 20);
    assert.equal(findVoice('bm_lewis')?.sid, 27);
  });

  it('describes voices for people', () => {
    const george = findVoice('bm_george');
    assert.ok(george);
    assert.equal(voiceLabel(george), 'George (British male)');
  });

  it('finds voices case-insensitively and rejects unknown ids', () => {
    assert.equal(findVoice(' AF_Heart ')?.id, 'af_heart');
    assert.equal(findVoice('zf_xiaobei'), undefined);
  });

  it('falls back to the default voice', () => {
    assert.equal(resolveVoice('nope').id, DEFAULT_VOICE_ID);
  });

  it('searches by name, accent and gender within the Discord limit', () => {
    assert.deepEqual(searchVoices('heart').map((voice) => voice.id), ['af_heart']);
    assert.ok(searchVoices('british male').every((voice) => voice.id.startsWith('bm_')));
    assert.equal(searchVoices('').length, 25);
  });
});
