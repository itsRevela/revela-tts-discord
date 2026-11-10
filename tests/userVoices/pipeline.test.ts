import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { encodeWav16 } from '../../src/audio/wav.ts';
import { checkClip, extensionOf, sniffFormat } from '../../src/userVoices/attachment.ts';
import { ClipDownloadError, downloadClip } from '../../src/userVoices/download.ts';
import { PocketVoiceError, createPocketVoiceClient, problemFor } from '../../src/userVoices/pocketClient.ts';

const bytes = (text: string, ...extra: number[]): Uint8Array => Uint8Array.from([...Buffer.from(text, 'latin1'), ...extra]);

describe('attachment checks', () => {
  it('accepts the supported formats by extension and maps Ogg variants', () => {
    assert.equal(extensionOf('Voice.WAV'), 'wav');
    assert.equal(extensionOf('note.opus'), 'ogg');
    assert.equal(extensionOf('clip.m4a'), undefined);
  });

  it('refuses unsupported, oversized and empty files before downloading', () => {
    const clip = { name: 'a.ogg', size: 1000, contentType: 'audio/ogg', url: 'https://cdn/a.ogg' };
    assert.deepEqual(checkClip(clip, 10_000), { ok: true, ext: 'ogg' });
    assert.match((checkClip({ ...clip, name: 'a.m4a' }, 10_000) as { problem: string }).problem, /isn't supported/);
    assert.match((checkClip({ ...clip, size: 20_000 }, 10_000) as { problem: string }).problem, /over/);
    assert.equal(checkClip({ ...clip, size: 0 }, 10_000).ok, false);
  });

  it('recognises formats by their first bytes', () => {
    assert.equal(sniffFormat(bytes('RIFF\0\0\0\0WAVEfmt ')), 'wav');
    assert.equal(sniffFormat(bytes('fLaC')), 'flac');
    assert.equal(sniffFormat(bytes('OggS')), 'ogg');
    assert.equal(sniffFormat(bytes('ID3')), 'mp3');
    assert.equal(sniffFormat(Uint8Array.from([0xff, 0xfb, 0x90])), 'mp3');
    assert.equal(sniffFormat(bytes('MZ\x90\0')), undefined, 'an executable is not audio');
  });
});

describe('downloadClip', () => {
  let directory = '';
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'clip-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const serving = (body: Uint8Array, status = 200): typeof fetch =>
    (async () => new Response(new Uint8Array(body), { status })) as typeof fetch;

  it('saves the file and returns its size and first bytes', async () => {
    const destination = path.join(directory, 'source.ogg');
    const result = await downloadClip('https://cdn/x', destination, 1000, { fetch: serving(bytes('OggS', 1, 2, 3)) });
    assert.equal(result.bytes, 7);
    assert.equal(sniffFormat(result.head), 'ogg');
    assert.equal((await readFile(destination)).length, 7);
  });

  it('stops at the size limit and leaves no file behind', async () => {
    const destination = path.join(directory, 'source.wav');
    await assert.rejects(downloadClip('https://cdn/x', destination, 4, { fetch: serving(bytes('RIFF1234WAVE')) }), ClipDownloadError);
    assert.equal(existsSync(destination), false);
  });

  it('reports Discord errors', async () => {
    await assert.rejects(downloadClip('https://cdn/x', path.join(directory, 'a'), 10, { fetch: serving(new Uint8Array(0), 404) }), /404/);
  });
});

describe('Pocket voice client', () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    if (String(url).endsWith('/prepare')) {
      return String(url).includes('aaaaaaaaaaaaa')
        ? Response.json({ id: 'aaaaaaaaaaaaa', durationSec: 42, truncated: true })
        : Response.json({ error: { code: 'too_short', message: 'short' } }, { status: 400 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const client = createPocketVoiceClient('http://pocket:8880', fakeFetch);

  it('prepares a clip and reports Pocket\'s refusals as readable problems', async () => {
    assert.deepEqual(await client.prepare('aaaaaaaaaaaaa'), { durationSec: 42, truncated: true });
    const error = await client.prepare('bbbbbbbbbbbbb').catch((caught: unknown) => caught);
    assert.ok(error instanceof PocketVoiceError && error.code === 'too_short');
    assert.match(problemFor(error), /too short/);
    assert.match(problemFor(new TypeError('fetch failed')), /couldn't be reached/);
  });

  it('forgets deleted voices', async () => {
    await client.forget('aaaaaaaaaaaaa');
    assert.ok(calls.includes('DELETE http://pocket:8880/v1/user-voices/aaaaaaaaaaaaa'));
  });
});

describe('encodeWav16', () => {
  it('writes a 44-byte PCM header followed by 16-bit samples', () => {
    const wav = encodeWav16(Float32Array.from([0, 1, -1, 2]), 24_000);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.length, 44 + 8);
    assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(50)], [0, 32767, -32767, 32767]);
  });
});
