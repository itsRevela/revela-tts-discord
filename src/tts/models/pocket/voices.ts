/**
 * Kyutai's English Pocket TTS voices, as offered by the Pocket server
 * (services/pocket, Kyutai's pocket-tts), plus custom voices it cloned from
 * recordings in data/voices/. Licences per the kyutai/tts-voices README.
 */
import { customVoiceId } from '../../customVoiceIds.ts';
import type { ServerVoiceList } from '../../speechServer/client.ts';
import type { ServerVoice } from '../../speechServer/engine.ts';
import type { Voice } from '../../types.ts';

export type VoiceLicense = 'CC BY 4.0' | 'CC0' | 'CC BY-NC 4.0';

export interface PocketVoice extends Voice {
  readonly license: VoiceLicense;
}

/** Kyutai's default voice, and what Pocket users get until they pick one; the server maps "default" to it. */
export const DEFAULT_POCKET_VOICE_ID = 'alba';

const VOICE_TABLE: readonly (readonly [id: string, license: VoiceLicense])[] = [
  ['alba', 'CC BY 4.0'],
  ['anna', 'CC BY 4.0'],
  ['azelma', 'CC BY 4.0'],
  ['bill_boerst', 'CC0'],
  ['caro_davy', 'CC0'],
  ['charles', 'CC BY 4.0'],
  ['cosette', 'CC BY-NC 4.0'],
  ['eponine', 'CC BY 4.0'],
  ['eve', 'CC BY 4.0'],
  ['fantine', 'CC BY 4.0'],
  ['george', 'CC BY 4.0'],
  ['jane', 'CC BY 4.0'],
  ['jean', 'CC BY-NC 4.0'],
  ['javert', 'CC0'],
  ['marius', 'CC0'],
  ['mary', 'CC BY 4.0'],
  ['michael', 'CC BY 4.0'],
  ['paul', 'CC BY 4.0'],
  ['peter_yearsley', 'CC0'],
  ['stuart_bell', 'CC0'],
  ['vera', 'CC BY 4.0'],
];

const titleCase = (id: string): string =>
  id.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

function toVoice([id, license]: readonly [string, VoiceLicense]): PocketVoice {
  const label = id === DEFAULT_POCKET_VOICE_ID ? `${titleCase(id)} (Kyutai's default)` : titleCase(id);
  return Object.freeze({ id, label, language: 'en', license });
}

/** Kyutai's default first, then alphabetical. */
export const POCKET_VOICES: readonly PocketVoice[] = Object.freeze(VOICE_TABLE.map(toVoice));

/**
 * The server's voices in catalog order (anything new on the server follows,
 * named from its id), then custom voices under the shared "custom:<slug>" ids.
 */
export function pocketVoices(list: ServerVoiceList): readonly ServerVoice[] {
  const offered = new Set(list.voices.map((name) => name.toLowerCase()).filter((name) => name !== 'default'));
  const known = POCKET_VOICES.filter((voice) => offered.has(voice.id)).map(({ license: _license, ...voice }) => ({
    ...voice,
    serverName: voice.id,
  }));
  const knownIds = new Set(known.map((voice) => voice.id));
  const extra = [...offered]
    .filter((name) => !knownIds.has(name))
    .sort()
    .map((name) => ({ id: name, serverName: name, label: titleCase(name), language: 'en' }));
  const custom = list.custom.flatMap((name) => {
    const id = customVoiceId(name);
    return id ? [{ id, serverName: name, label: name, language: 'en', custom: true }] : [];
  });
  return [...known, ...extra, ...custom];
}
