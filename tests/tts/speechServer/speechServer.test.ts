import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { silentLogger } from '../../../src/logging/logger.ts';
import { neuttsVoices } from '../../../src/tts/models/neutts/voices.ts';
import { phononVoices } from '../../../src/tts/models/phonon/voices.ts';
import { fetchVoiceList, streamSpeech, waitForServer } from '../../../src/tts/speechServer/client.ts';
import { loadSpeechServerModel } from '../../../src/tts/speechServer/engine.ts';
import { createPcm16Decoder } from '../../../src/tts/speechServer/pcm16.ts';
import { speechServerSettings } from '../../../src/tts/speechServer/settings.ts';

describe('phononVoices', () => {
  it('orders default first, then the catalog, then unknown names, with labels and groups', () => {
    const voices = phononVoices({ voices: ['Zebedee', 'Azgorath', 'Zoey', 'default', 'Maeve'], custom: [] });
    assert.deepEqual(voices.map((voice) => voice.id), ['default', 'Zoey', 'Maeve', 'Azgorath', 'Zebedee']);
    assert.equal(voices[1]?.label, 'Zoey (American female)');
    assert.equal(voices[2]?.label, 'Maeve (British female)');
    assert.equal(voices[3]?.category, 'Characters');
    assert.equal(voices[3]?.description, 'Ancient demon, cavernous bass');
    assert.equal(voices[4]?.label, 'Zebedee');
    assert.ok(voices.every((voice) => voice.language === 'en' && voice.serverName === voice.id));
  });
});

describe('neuttsVoices', () => {
  it('puts Jo (the default) first, then the rest alphabetically, drops the alias, then adds custom voices', () => {
    const voices = neuttsVoices({ voices: ['steven', 'default', 'Dave', 'jo'], custom: ['Tony Balogna'] });
    assert.deepEqual(voices.map((voice) => voice.id), ['jo', 'dave', 'steven', 'custom:tony_balogna']);
    assert.equal(voices[0]?.label, 'Jo (default)');
    assert.equal(voices[1]?.label, 'Dave');
    assert.deepEqual(voices[3], { id: 'custom:tony_balogna', serverName: 'Tony Balogna', label: 'Tony Balogna', language: 'en', custom: true });
  });
});

describe('createPcm16Decoder', () => {
  it('decodes little-endian samples and carries a split sample to the next chunk', () => {
    const decode = createPcm16Decoder();
    const bytes = Buffer.alloc(6);
    bytes.writeInt16LE(16384, 0);
    bytes.writeInt16LE(-32768, 2);
    bytes.writeInt16LE(32767, 4);
    assert.deepEqual([...decode(bytes.subarray(0, 3))], [0.5]);
    const rest = decode(bytes.subarray(3));
    assert.deepEqual([...rest].map((value) => Number(value.toFixed(4))), [-1, 1]);
  });
});

const PHONON_SETTINGS = {
  urlVariable: 'PHONON_URL',
  timeoutVariable: 'PHONON_STARTUP_TIMEOUT_SECONDS',
  defaultUrl: 'http://phonon:8880',
  defaultTimeoutSeconds: 300,
};

describe('speechServerSettings', () => {
  it('defaults to the compose service and validates input', () => {
    assert.deepEqual(speechServerSettings({}, PHONON_SETTINGS), { url: 'http://phonon:8880', startupTimeoutMs: 300_000 });
    assert.equal(speechServerSettings({ PHONON_URL: 'http://10.0.0.5:9000/' }, PHONON_SETTINGS).url, 'http://10.0.0.5:9000');
    assert.throws(() => speechServerSettings({ PHONON_URL: 'not a url' }, PHONON_SETTINGS), /PHONON_URL/);
    assert.throws(() => speechServerSettings({ PHONON_URL: 'ftp://x' }, PHONON_SETTINGS), /http or https/);
    assert.throws(() => speechServerSettings({ PHONON_STARTUP_TIMEOUT_SECONDS: '-1' }, PHONON_SETTINGS), /PHONON_STARTUP_TIMEOUT_SECONDS/);
  });
});

/** A stand-in for ptts-openai-server that streams PCM in odd-sized chunks. */
function fakePhononServer(): { server: Server; requests: unknown[]; busyFirst: { count: number } } {
  const requests: unknown[] = [];
  const busyFirst = { count: 0 };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.end('{"status":"ok"}');
      return;
    }
    if (req.url === '/v1/audio/voices') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ voices: ['default', 'Zoey', 'Azgorath'], custom: ['Tony Balogna'], aliases: {} }));
      return;
    }
    if (req.url === '/v1/audio/speech') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const parsed = JSON.parse(body) as { input: string; voice: string };
        requests.push(parsed);
        if (busyFirst.count > 0) {
          busyFirst.count -= 1;
          res.statusCode = 429;
          res.end(JSON.stringify({ error: { message: 'busy', code: 'server_busy' } }));
          return;
        }
        if (parsed.voice === 'broken') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { message: 'unknown voice "broken"' } }));
          return;
        }
        const pcm = Buffer.alloc(2 * 24_000); // one second of silence
        res.write(pcm.subarray(0, 4801));
        res.write(pcm.subarray(4801, 9999));
        res.end(pcm.subarray(9999));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return { server, requests, busyFirst };
}

describe('speech server client and engine', () => {
  const fake = fakePhononServer();
  let url = '';

  before(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });

  it('waits for health and lists voices', async () => {
    await waitForServer(url, 1000, () => assert.fail('should already be ready'));
    assert.deepEqual(await fetchVoiceList(url), { voices: ['default', 'Zoey', 'Azgorath'], custom: ['Tony Balogna'] });
  });

  it('gives up waiting for a server that never answers', async () => {
    let waited = false;
    await assert.rejects(waitForServer('http://127.0.0.1:1', 0, () => { waited = true; }), /did not become ready/);
    assert.equal(waited, false);
  });

  it('streams a full second of audio across uneven chunks', async () => {
    let samples = 0;
    await streamSpeech(url, { text: 'hello', voice: 'Zoey' }, (chunk) => {
      assert.equal(chunk.sampleRate, 24_000);
      samples += chunk.samples.length;
    });
    assert.equal(samples, 24_000);
    assert.deepEqual(fake.requests.at(-1), { model: 'tts-1', input: 'hello', voice: 'Zoey', response_format: 'pcm' });
  });

  it('retries when the server is busy, and reports other errors', async () => {
    fake.busyFirst.count = 1;
    let samples = 0;
    await streamSpeech(url, { text: 'hi', voice: 'Zoey' }, (chunk) => { samples += chunk.samples.length; });
    assert.equal(samples, 24_000);
    await assert.rejects(streamSpeech(url, { text: 'hi', voice: 'broken' }, () => undefined), /unknown voice "broken"/);
  });

  it('does nothing once aborted', async () => {
    const before = fake.requests.length;
    await streamSpeech(url, { text: 'hi', voice: 'Zoey', signal: AbortSignal.abort() }, () => assert.fail('no audio expected'));
    assert.equal(fake.requests.length, before);
  });

  it('loads as a model whose voices come from the server, falling back to default', async () => {
    const engine = await loadSpeechServerModel(
      { name: 'Phonon', settings: PHONON_SETTINGS, fallbackVoice: 'default', describeVoices: phononVoices },
      { modelDir: '', customVoicesDir: '', numThreads: 1, speed: 1, env: { PHONON_URL: url }, logger: silentLogger },
    );
    assert.deepEqual(engine.voices.map((voice) => voice.id), ['default', 'Zoey', 'Azgorath']);
    await engine.synthesize({ text: 'hi', voiceId: 'retired-voice', onChunk: () => undefined });
    assert.equal((fake.requests.at(-1) as { voice: string }).voice, 'default');
  });

  it('sends a custom voice to the server by its own name', async () => {
    const engine = await loadSpeechServerModel(
      { name: 'NeuTTS', settings: { ...PHONON_SETTINGS, urlVariable: 'NEUTTS_URL' }, fallbackVoice: 'jo', describeVoices: neuttsVoices },
      { modelDir: '', customVoicesDir: '', numThreads: 1, speed: 1, env: { NEUTTS_URL: url }, logger: silentLogger },
    );
    assert.ok(engine.voices.some((voice) => voice.id === 'custom:tony_balogna' && voice.custom));
    assert.ok(engine.voices.every((voice) => !('serverName' in voice)));
    await engine.synthesize({ text: 'hi', voiceId: 'custom:tony_balogna', onChunk: () => undefined });
    assert.equal((fake.requests.at(-1) as { voice: string }).voice, 'Tony Balogna');
  });
});
