import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { customVoiceId } from '../../customVoiceIds.ts';
import type { Voice } from '../../types.ts';

const MAX_NAME_LENGTH = 60;

export interface CustomVoice extends Voice {
  readonly custom: true;
  /** Absolute path of the reference recording. */
  readonly file: string;
}

function isMissingDirectory(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The display name is the file name as written: "Tony Balogna.wav" -> "Tony Balogna". */
export function customVoiceName(fileName: string): string {
  return path.parse(fileName).name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export { customVoiceId };

/**
 * Lists the .wav recordings in `directory` as clonable voices, named after
 * their files. A missing directory just means no custom voices.
 */
export async function listCustomVoices(directory: string): Promise<readonly CustomVoice[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error: unknown) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }
  const voices = entries
    .filter((entry) => entry.toLowerCase().endsWith('.wav'))
    .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .flatMap((entry): CustomVoice[] => {
      const name = customVoiceName(entry);
      const id = customVoiceId(name);
      return id ? [{ id, label: name, custom: true, file: path.join(directory, entry) }] : [];
    });
  // Two files that differ only in case or punctuation keep the first.
  return voices.filter((voice, index) => voices.findIndex((other) => other.id === voice.id) === index);
}
