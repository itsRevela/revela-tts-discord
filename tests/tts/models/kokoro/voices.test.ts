import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kokoroModel } from '../../../../src/tts/models/kokoro/index.ts';
import {
  DEFAULT_KOKORO_VOICE_ID,
  KOKORO_VOICES,
  KOKORO_VOICES_BY_GRADE,
  findKokoroVoice,
} from '../../../../src/tts/models/kokoro/voices.ts';

describe('Kokoro voice table', () => {
  it('lists 28 English voices (speakers 0-27) and 8 Mandarin ones (speakers 45-52)', () => {
    assert.equal(KOKORO_VOICES.length, 36);
    const english = KOKORO_VOICES.filter((voice) => voice.accent !== 'Chinese');
    const chinese = KOKORO_VOICES.filter((voice) => voice.accent === 'Chinese');
    assert.deepEqual(english.map((voice) => voice.sid), [...Array(28).keys()]);
    assert.deepEqual(chinese.map((voice) => voice.sid), [45, 46, 47, 48, 49, 50, 51, 52]);
  });

  it('labels the Mandarin voices so they can be searched for', () => {
    assert.equal(findKokoroVoice('zf_xiaoxiao')?.label, 'Xiaoxiao (Chinese female) · grade D');
    assert.equal(findKokoroVoice('zm_yunyang')?.sid, 52);
    assert.equal(KOKORO_VOICES.filter((voice) => voice.label.includes('Chinese')).length, 8);
  });

  it('matches the sherpa-onnx speaker ids for known voices', () => {
    assert.equal(findKokoroVoice('af_heart')?.sid, 3);
    assert.equal(findKokoroVoice('am_adam')?.sid, 11);
    assert.equal(findKokoroVoice('bf_alice')?.sid, 20);
    assert.equal(findKokoroVoice('bm_lewis')?.sid, 27);
  });

  it('labels voices with accent, gender and grade', () => {
    assert.equal(findKokoroVoice('bm_george')?.label, 'George (British male) · grade C');
  });

  it('carries the grades from Kokoro\'s voice list', () => {
    assert.equal(findKokoroVoice('af_heart')?.grade, 'A');
    assert.equal(findKokoroVoice('af_bella')?.grade, 'A-');
    assert.equal(findKokoroVoice('bf_emma')?.grade, 'B-');
    assert.equal(findKokoroVoice('bm_lewis')?.grade, 'D+');
    assert.equal(findKokoroVoice('am_adam')?.grade, 'F+');
  });

  it('orders the model\'s catalog best grade first', () => {
    const order = ['A', 'A-', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+'];
    const ranks = KOKORO_VOICES_BY_GRADE.map((voice) => order.indexOf(voice.grade));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.deepEqual(KOKORO_VOICES_BY_GRADE.slice(0, 4).map((voice) => voice.id), ['af_heart', 'af_bella', 'af_nicole', 'bf_emma']);
    assert.equal(kokoroModel.voices, KOKORO_VOICES_BY_GRADE);
    assert.equal(kokoroModel.defaultVoiceId, DEFAULT_KOKORO_VOICE_ID);
  });

  it('rejects unknown ids', () => {
    assert.equal(findKokoroVoice('jf_alpha'), undefined);
  });
});
