/**
 * English voices in the sherpa-onnx `kokoro-multi-lang-v1_0` model, keyed by
 * Kokoro's voice id. Speaker ids (sid) follow the sherpa-onnx voice table:
 * https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_0.html
 */
export type Accent = 'American' | 'British';
export type VoiceGender = 'female' | 'male';

export interface Voice {
  readonly id: string;
  readonly sid: number;
  readonly name: string;
  readonly accent: Accent;
  readonly gender: VoiceGender;
}

export const DEFAULT_VOICE_ID = 'af_heart';

const ACCENTS: Readonly<Record<string, Accent>> = { a: 'American', b: 'British' };
const GENDERS: Readonly<Record<string, VoiceGender>> = { f: 'female', m: 'male' };

const VOICE_IDS: readonly string[] = [
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
];

function toVoice(id: string, sid: number): Voice {
  const [prefix = '', rawName = ''] = id.split('_');
  const accent = ACCENTS[prefix.charAt(0)];
  const gender = GENDERS[prefix.charAt(1)];
  if (!accent || !gender || !rawName) {
    throw new Error(`Malformed Kokoro voice id: ${id}`);
  }
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  return Object.freeze({ id, sid, name, accent, gender });
}

/** The sid of each voice is its index in VOICE_IDS (the model's speaker order). */
export const VOICES: readonly Voice[] = Object.freeze(VOICE_IDS.map(toVoice));

const BY_ID: ReadonlyMap<string, Voice> = new Map(VOICES.map((voice) => [voice.id, voice]));

export function findVoice(id: string): Voice | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

/** The configured voice, falling back to the default if the id is unknown. */
export function resolveVoice(id: string): Voice {
  const voice = findVoice(id) ?? findVoice(DEFAULT_VOICE_ID);
  if (!voice) throw new Error(`Default voice ${DEFAULT_VOICE_ID} is missing from the voice table`);
  return voice;
}

export function voiceLabel(voice: Voice): string {
  return `${voice.name} (${voice.accent} ${voice.gender})`;
}

/** Case-insensitive match on id, name, accent or gender, capped for Discord autocomplete. */
export function searchVoices(query: string, limit = 25): readonly Voice[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? VOICES.filter((voice) => `${voice.id} ${voiceLabel(voice)}`.toLowerCase().includes(needle))
    : VOICES;
  return matches.slice(0, limit);
}
