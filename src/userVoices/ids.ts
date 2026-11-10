import { randomBytes } from 'node:crypto';

/**
 * Uploaded voices have random, permanent ids (13 base32 characters), so a
 * rename never touches preferences, the Pocket server or its cache. In voice
 * lists and preferences they appear as "user:<id>".
 */
export const USER_VOICE_PREFIX = 'user:';
const ID_LENGTH = 13;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const ID = /^[a-z2-7]{13}$/;

/** 256 is a multiple of 32, so each byte maps to a character without bias. */
export function newUserVoiceId(random: (size: number) => Uint8Array = randomBytes): string {
  return Array.from(random(ID_LENGTH), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export const isUserVoiceId = (id: string): boolean => ID.test(id);

/** "user:<id>": the voice id used by /voice, preferences and the Pocket server. */
export const userVoiceKey = (id: string): string => `${USER_VOICE_PREFIX}${id}`;

/** The id in "user:<id>", or undefined for any other voice id. */
export function parseUserVoiceKey(voiceId: string): string | undefined {
  if (!voiceId.startsWith(USER_VOICE_PREFIX)) return undefined;
  const id = voiceId.slice(USER_VOICE_PREFIX.length);
  return isUserVoiceId(id) ? id : undefined;
}
