/**
 * NeuTTS Air's voices: Neuphonic's English sample voices
 * (github.com/neuphonic/neutts, samples/), plus custom voices the server
 * prepared from recordings in data/voices/.
 */
import { customVoiceId } from '../../customVoiceIds.ts';
import type { ServerVoiceList } from '../../speechServer/client.ts';
import type { ServerVoice } from '../../speechServer/engine.ts';

/** The server maps "default" to this voice. */
export const NEUTTS_DEFAULT_VOICE = 'jo';

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

function builtInVoices(names: readonly string[]): readonly ServerVoice[] {
  const unique = [...new Set(names.map((name) => name.toLowerCase()))].filter((name) => name !== 'default');
  const isDefault = (name: string): number => Number(name === NEUTTS_DEFAULT_VOICE);
  const sorted = unique.sort((a, b) => isDefault(b) - isDefault(a) || a.localeCompare(b));
  return sorted.map((name) => ({
    id: name,
    serverName: name,
    label: name === NEUTTS_DEFAULT_VOICE ? `${capitalize(name)} (default)` : capitalize(name),
    language: 'en',
  }));
}

/** Custom voices use the shared "custom:<slug>" ids, so the same person matches across models. */
function customVoices(names: readonly string[]): readonly ServerVoice[] {
  return names.flatMap((name) => {
    const id = customVoiceId(name);
    return id ? [{ id, serverName: name, label: name, language: 'en', custom: true }] : [];
  });
}

/** Default (Jo) first, then the other sample voices alphabetically, then custom voices. */
export function neuttsVoices(list: ServerVoiceList): readonly ServerVoice[] {
  return [...builtInVoices(list.voices), ...customVoices(list.custom)];
}
