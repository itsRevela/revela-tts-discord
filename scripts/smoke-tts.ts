// Loads the Kokoro model and synthesizes a sample without touching Discord.
// Usage: node scripts/smoke-tts.ts [voice-id] [text]
// Reads KOKORO_MODEL_DIR and TTS_THREADS like the bot does. Also checks that
// synthesis leaves the event loop free, since Discord audio is paced from it.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DISCORD_SAMPLE_RATE, toDiscordPcm } from '../src/audio/pcm.ts';
import { createKokoroEngine } from '../src/tts/kokoroEngine.ts';
import { resolveVoice } from '../src/tts/voices.ts';

const MAX_EVENT_LOOP_DELAY_MS = 50;

const modelDir = process.env['KOKORO_MODEL_DIR'] ?? '/models/kokoro';
const numThreads = Number(process.env['TTS_THREADS'] ?? 4);
const voice = resolveVoice(process.argv[2] ?? 'af_heart');
const text = process.argv[3] ?? 'Revela says, gg lol, that was poggers. Is anyone up for another round?';
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const loadStarted = performance.now();
const engine = await createKokoroEngine({ modelDir, numThreads, speed: 1 });
write(`model loaded in ${Math.round(performance.now() - loadStarted)} ms (${numThreads} threads)`);

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
const started = performance.now();
let pcmBytes = 0;
let chunks = 0;
await engine.synthesize({
  text,
  sid: voice.sid,
  onChunk: (chunk) => {
    chunks += 1;
    pcmBytes += toDiscordPcm(chunk.samples, chunk.sampleRate).length;
    const seconds = chunk.samples.length / chunk.sampleRate;
    write(`chunk ${chunks}: ${seconds.toFixed(2)} s audio at ${Math.round(performance.now() - started)} ms`);
  },
});
loopDelay.disable();

const audioSeconds = pcmBytes / 4 / DISCORD_SAMPLE_RATE;
const elapsed = (performance.now() - started) / 1000;
const maxDelayMs = loopDelay.max / 1e6;
write(`${voice.id}: ${audioSeconds.toFixed(2)} s of audio in ${elapsed.toFixed(2)} s (RTF ${(elapsed / audioSeconds).toFixed(2)})`);
write(`max event-loop delay during synthesis: ${maxDelayMs.toFixed(1)} ms`);

if (chunks === 0 || audioSeconds < 0.5) {
  process.stderr.write('smoke test failed: no audio produced\n');
  process.exit(1);
}
if (maxDelayMs > MAX_EVENT_LOOP_DELAY_MS) {
  process.stderr.write(`smoke test failed: synthesis blocked the event loop for ${maxDelayMs.toFixed(1)} ms\n`);
  process.exit(1);
}
