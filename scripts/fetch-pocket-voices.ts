// Downloads Kyutai's Pocket TTS voice catalog into <model dir>/voices.
// Used while building the image: node scripts/fetch-pocket-voices.ts /models/pocket
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { POCKET_VOICES, POCKET_VOICES_DIR, pocketVoiceFileName, pocketVoiceUrl } from '../src/tts/models/pocket/voices.ts';

const modelDir = process.argv[2];
if (!modelDir) {
  process.stderr.write('usage: node scripts/fetch-pocket-voices.ts <pocket model dir>\n');
  process.exit(1);
}
const target = path.join(modelDir, POCKET_VOICES_DIR);
await mkdir(target, { recursive: true });

for (const voice of POCKET_VOICES) {
  const response = await fetch(pocketVoiceUrl(voice));
  if (!response.ok) throw new Error(`Download of ${voice.id} failed: HTTP ${response.status}`);
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(target, pocketVoiceFileName(voice)), audio);
  process.stdout.write(`${voice.id} (${voice.license}): ${audio.length} bytes\n`);
}
