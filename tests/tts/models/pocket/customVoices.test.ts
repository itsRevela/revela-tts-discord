import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { customVoiceId, customVoiceName, listCustomVoices } from '../../../../src/tts/models/pocket/customVoices.ts';

describe('custom voice names', () => {
  it('keeps the file name as written', () => {
    assert.equal(customVoiceName('Tony Balogna.wav'), 'Tony Balogna');
    assert.equal(customVoiceName('MoistCr1tikal.wav'), 'MoistCr1tikal');
    assert.equal(customVoiceName('rekp.wav'), 'rekp');
  });

  it('derives a stable, case-insensitive id', () => {
    assert.equal(customVoiceId('Tony Balogna'), 'custom:tony_balogna');
    assert.equal(customVoiceId('MoistCr1tikal'), 'custom:moistcr1tikal');
    assert.equal(customVoiceId('!!!'), undefined);
  });
});

describe('listCustomVoices', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tts-voices-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists .wav recordings as custom voices, sorted by name', async () => {
    for (const name of ['rekp.wav', 'Donald Trump.wav', 'notes.txt', 'Tony Balogna.WAV']) {
      await writeFile(path.join(directory, name), '');
    }
    const voices = await listCustomVoices(directory);
    assert.deepEqual(voices.map((voice) => [voice.id, voice.label]), [
      ['custom:donald_trump', 'Donald Trump'],
      ['custom:rekp', 'rekp'],
      ['custom:tony_balogna', 'Tony Balogna'],
    ]);
    assert.ok(voices.every((voice) => voice.custom && voice.file.startsWith(directory)));
  });

  it('keeps the first of two files that only differ in case', async () => {
    await writeFile(path.join(directory, 'Rekp.wav'), '');
    await writeFile(path.join(directory, 'rekp!.wav'), '');
    assert.equal((await listCustomVoices(directory)).length, 1);
  });

  it('treats a missing folder as no custom voices', async () => {
    assert.deepEqual(await listCustomVoices(path.join(directory, 'absent')), []);
  });
});
