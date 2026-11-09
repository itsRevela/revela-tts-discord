/**
 * Kyutai's English Pocket TTS voice catalog (pocket-tts README). Pocket clones
 * a voice from a short reference recording; these are downloaded from
 * https://huggingface.co/kyutai/tts-voices at image build time
 * (scripts/fetch-pocket-voices.ts). Licences per that repository's README.
 */
import type { Voice } from '../../types.ts';

export type VoiceLicense = 'CC BY 4.0' | 'CC0' | 'CC BY-NC 4.0';

export interface PocketVoice extends Voice {
  readonly name: string;
  /** Path inside the kyutai/tts-voices repository. */
  readonly source: string;
  readonly license: VoiceLicense;
}

export const DEFAULT_POCKET_VOICE_ID = 'alba';
export const KYUTAI_VOICES_BASE_URL = 'https://huggingface.co/kyutai/tts-voices/resolve/main/';
/** Reference recordings live in this subfolder of the Pocket model folder. */
export const POCKET_VOICES_DIR = 'voices';

const VOICE_TABLE: readonly (readonly [id: string, source: string, license: VoiceLicense])[] = [
  ['alba', 'alba-mackenna/casual.wav', 'CC BY 4.0'],
  ['anna', 'vctk/p228_023_enhanced.wav', 'CC BY 4.0'],
  ['azelma', 'vctk/p303_023_enhanced.wav', 'CC BY 4.0'],
  ['bill_boerst', 'voice-zero/bill_boerst.wav', 'CC0'],
  ['caro_davy', 'voice-zero/caro_davy.wav', 'CC0'],
  ['charles', 'vctk/p254_023_enhanced.wav', 'CC BY 4.0'],
  ['cosette', 'expresso/ex04-ex02_confused_001_channel1_499s.wav', 'CC BY-NC 4.0'],
  ['eponine', 'vctk/p262_023_enhanced.wav', 'CC BY 4.0'],
  ['eve', 'vctk/p361_023_enhanced.wav', 'CC BY 4.0'],
  ['fantine', 'vctk/p244_023_enhanced.wav', 'CC BY 4.0'],
  ['george', 'vctk/p315_023_enhanced.wav', 'CC BY 4.0'],
  ['jane', 'vctk/p339_023_enhanced.wav', 'CC BY 4.0'],
  ['jean', 'ears/p010/freeform_speech_01_enhanced.wav', 'CC BY-NC 4.0'],
  ['javert', 'voice-donations/Butter.wav', 'CC0'],
  ['marius', 'voice-donations/Selfie.wav', 'CC0'],
  ['mary', 'vctk/p333_023_enhanced.wav', 'CC BY 4.0'],
  ['michael', 'vctk/p360_023_enhanced.wav', 'CC BY 4.0'],
  ['paul', 'vctk/p259_023_enhanced.wav', 'CC BY 4.0'],
  ['peter_yearsley', 'voice-zero/peter_yearsley.wav', 'CC0'],
  ['stuart_bell', 'voice-zero/stuart_bell.wav', 'CC0'],
  ['vera', 'vctk/p229_023_enhanced.wav', 'CC BY 4.0'],
];

function toVoice([id, source, license]: readonly [string, string, VoiceLicense]): PocketVoice {
  const name = id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const label = id === DEFAULT_POCKET_VOICE_ID ? `${name} (Kyutai's default)` : name;
  return Object.freeze({ id, label, name, source, license });
}

/** Kyutai's default first, then alphabetical. */
export const POCKET_VOICES: readonly PocketVoice[] = Object.freeze(VOICE_TABLE.map(toVoice));

export function pocketVoiceFileName(voice: PocketVoice): string {
  return `${voice.id}.wav`;
}

export function pocketVoiceUrl(voice: PocketVoice): string {
  return `${KYUTAI_VOICES_BASE_URL}${voice.source}`;
}
