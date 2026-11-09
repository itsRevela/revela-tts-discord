// Loads one model and synthesizes a sample without touching Discord.
// Usage: node scripts/smoke-tts.ts [model] [voice-id] [text]
// Reads MODELS_DIR, DATA_DIR and TTS_THREADS like the bot does. Also checks
// that synthesis leaves the event loop free, since Discord audio is paced from it.
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DISCORD_SAMPLE_RATE, toDiscordPcm } from '../src/audio/pcm.ts';
import { createLogger } from '../src/logging/logger.ts';
import { loadModels } from '../src/tts/loadModels.ts';
import { findModelDefinition } from '../src/tts/modelRegistry.ts';

const MAX_EVENT_LOOP_DELAY_MS = 50;

const definition = findModelDefinition(process.argv[2] ?? 'pocket');
if (!definition) {
  process.stderr.write(`unknown model "${process.argv[2]}"\n`);
  process.exit(1);
}
const voiceId = process.argv[3] ?? definition.defaultVoiceId;
const text = process.argv[4] ?? 'Revela says, gg lol, that was poggers. Is anyone up for another round?';
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const [model] = await loadModels([definition], {
  modelsDir: process.env['MODELS_DIR'] ?? '/models',
  customVoicesDir: path.join(process.env['DATA_DIR'] ?? '/data', 'voices'),
  numThreads: Number(process.env['TTS_THREADS'] ?? 4),
  speed: 1,
  env: process.env,
  required: [definition.id],
  logger: createLogger('info'),
});
if (!model) throw new Error('model failed to load');
if (!model.voices.some((voice) => voice.id === voiceId)) {
  process.stderr.write(`unknown voice "${voiceId}"; available: ${model.voices.map((voice) => voice.id).join(', ')}\n`);
  process.exit(1);
}

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();
const started = performance.now();
let pcmBytes = 0;
let chunks = 0;
await model.engine.synthesize({
  text,
  voiceId,
  onChunk: (chunk) => {
    chunks += 1;
    pcmBytes += toDiscordPcm(chunk.samples, chunk.sampleRate).length;
    if (chunks === 1) write(`first audio after ${Math.round(performance.now() - started)} ms`);
  },
});
loopDelay.disable();

const audioSeconds = pcmBytes / 4 / DISCORD_SAMPLE_RATE;
const elapsed = (performance.now() - started) / 1000;
const maxDelayMs = loopDelay.max / 1e6;
write(`${model.id}/${voiceId}: ${audioSeconds.toFixed(2)} s of audio in ${elapsed.toFixed(2)} s over ${chunks} chunks (RTF ${(elapsed / audioSeconds).toFixed(2)})`);
write(`max event-loop delay during synthesis: ${maxDelayMs.toFixed(1)} ms`);

if (chunks === 0 || audioSeconds < 0.5) {
  process.stderr.write('smoke test failed: no audio produced\n');
  process.exit(1);
}
if (maxDelayMs > MAX_EVENT_LOOP_DELAY_MS) {
  process.stderr.write(`smoke test failed: synthesis blocked the event loop for ${maxDelayMs.toFixed(1)} ms\n`);
  process.exit(1);
}
