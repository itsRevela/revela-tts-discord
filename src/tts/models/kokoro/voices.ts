/**
 * English and Mandarin Chinese voices in the sherpa-onnx `kokoro-multi-lang-v1_0`
 * model. Speaker ids (sid) match the model's own id2speaker metadata and the
 * sherpa-onnx voice table:
 * https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_0.html
 * Grades are the "Overall Grade" from Kokoro's own voice list:
 * https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
 */
import type { Voice } from '../../types.ts';

export type Accent = 'American' | 'British' | 'Chinese';
export type VoiceGender = 'female' | 'male';
export type VoiceGrade = 'A' | 'A-' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F+';

export interface KokoroVoice extends Voice {
  readonly sid: number;
  readonly name: string;
  readonly accent: Accent;
  readonly gender: VoiceGender;
  readonly grade: VoiceGrade;
}

export const DEFAULT_KOKORO_VOICE_ID = 'af_heart';

const ACCENTS: Readonly<Record<string, Accent>> = { a: 'American', b: 'British', z: 'Chinese' };
const GENDERS: Readonly<Record<string, VoiceGender>> = { f: 'female', m: 'male' };

/** Best first. */
const GRADE_ORDER: readonly VoiceGrade[] = ['A', 'A-', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F+'];

/** English voices are speakers 0-27 in order; the Mandarin ones are 45-52. */
const VOICE_TABLE: readonly (readonly [id: string, grade: VoiceGrade, sid: number])[] = [
  ['af_alloy', 'C', 0], ['af_aoede', 'C+', 1], ['af_bella', 'A-', 2], ['af_heart', 'A', 3],
  ['af_jessica', 'D', 4], ['af_kore', 'C+', 5], ['af_nicole', 'B-', 6], ['af_nova', 'C', 7],
  ['af_river', 'D', 8], ['af_sarah', 'C+', 9], ['af_sky', 'C-', 10],
  ['am_adam', 'F+', 11], ['am_echo', 'D', 12], ['am_eric', 'D', 13], ['am_fenrir', 'C+', 14],
  ['am_liam', 'D', 15], ['am_michael', 'C+', 16], ['am_onyx', 'D', 17], ['am_puck', 'C+', 18], ['am_santa', 'D-', 19],
  ['bf_alice', 'D', 20], ['bf_emma', 'B-', 21], ['bf_isabella', 'C', 22], ['bf_lily', 'D', 23],
  ['bm_daniel', 'D', 24], ['bm_fable', 'C', 25], ['bm_george', 'C', 26], ['bm_lewis', 'D+', 27],
  ['zf_xiaobei', 'D', 45], ['zf_xiaoni', 'D', 46], ['zf_xiaoxiao', 'D', 47], ['zf_xiaoyi', 'D', 48],
  ['zm_yunjian', 'D', 49], ['zm_yunxi', 'D', 50], ['zm_yunxia', 'D', 51], ['zm_yunyang', 'D', 52],
];

function toVoice([id, grade, sid]: readonly [string, VoiceGrade, number]): KokoroVoice {
  const [prefix = '', rawName = ''] = id.split('_');
  const accent = ACCENTS[prefix.charAt(0)];
  const gender = GENDERS[prefix.charAt(1)];
  if (!accent || !gender || !rawName) {
    throw new Error(`Malformed Kokoro voice id: ${id}`);
  }
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  const label = `${name} (${accent} ${gender}) · grade ${grade}`;
  const language = accent === 'Chinese' ? 'zh' : 'en';
  return Object.freeze({ id, label, language, sid, name, accent, gender, grade });
}

/** In speaker-id order. */
export const KOKORO_VOICES: readonly KokoroVoice[] = Object.freeze(VOICE_TABLE.map(toVoice));

/** Best grade first; voices with the same grade keep speaker-id order. */
export const KOKORO_VOICES_BY_GRADE: readonly KokoroVoice[] = Object.freeze(
  [...KOKORO_VOICES].sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade)),
);

const BY_ID: ReadonlyMap<string, KokoroVoice> = new Map(KOKORO_VOICES.map((voice) => [voice.id, voice]));

export function findKokoroVoice(id: string): KokoroVoice | undefined {
  return BY_ID.get(id);
}
