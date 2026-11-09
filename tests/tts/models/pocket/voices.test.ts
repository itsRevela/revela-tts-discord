import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pocketModel } from '../../../../src/tts/models/pocket/index.ts';
import {
  DEFAULT_POCKET_VOICE_ID,
  POCKET_VOICES,
  pocketVoiceFileName,
  pocketVoiceUrl,
} from '../../../../src/tts/models/pocket/voices.ts';

describe('Pocket voice catalog', () => {
  it('lists Kyutai\'s 21 English voices with unique ids, Alba first', () => {
    assert.equal(POCKET_VOICES.length, 21);
    assert.equal(new Set(POCKET_VOICES.map((voice) => voice.id)).size, 21);
    assert.equal(POCKET_VOICES[0]?.id, DEFAULT_POCKET_VOICE_ID);
    assert.equal(pocketModel.defaultVoiceId, 'alba');
  });

  it('names voices for people and marks the default', () => {
    const byId = new Map(POCKET_VOICES.map((voice) => [voice.id, voice]));
    assert.equal(byId.get('alba')?.label, "Alba (Kyutai's default)");
    assert.equal(byId.get('peter_yearsley')?.label, 'Peter Yearsley');
    assert.ok(POCKET_VOICES.every((voice) => !voice.custom));
  });

  it('downloads each voice from the kyutai/tts-voices repository', () => {
    const alba = POCKET_VOICES[0];
    assert.ok(alba);
    assert.equal(pocketVoiceUrl(alba), 'https://huggingface.co/kyutai/tts-voices/resolve/main/alba-mackenna/casual.wav');
    assert.equal(pocketVoiceFileName(alba), 'alba.wav');
  });

  it('records a licence for every voice', () => {
    assert.ok(POCKET_VOICES.every((voice) => ['CC BY 4.0', 'CC0', 'CC BY-NC 4.0'].includes(voice.license)));
  });
});
