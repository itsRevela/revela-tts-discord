import { z } from 'zod';
import { findVoice } from '../tts/voices.ts';

export interface UserPreferences {
  /** Kokoro voice id, e.g. "af_heart". */
  readonly voice: string;
  /** Say "<name> says," before this user's messages when the speaker changes. */
  readonly announceName: boolean;
}

export type PreferencePatch = Partial<UserPreferences>;

/** Only the values a user changed are stored; everything else uses the defaults. */
export type StoredPreferences = Readonly<Record<string, Readonly<PreferencePatch>>>;

const USER_ID = /^\d{17,20}$/;

const patchSchema = z.object({
  voice: z.string().refine((id) => findVoice(id) !== undefined, 'unknown voice').optional(),
  announceName: z.boolean().optional(),
});

const fileSchema = z.record(z.string(), z.unknown());

export interface ParsedPreferences {
  readonly preferences: StoredPreferences;
  /** Entries skipped because the user id or values were invalid. */
  readonly dropped: number;
}

/** Validates untrusted file content entry by entry, keeping every valid entry. */
export function parseStoredPreferences(json: unknown): ParsedPreferences {
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new Error('Preferences file must contain a JSON object');
  const entries = Object.entries(file.data);
  const valid = entries.flatMap(([userId, value]) => {
    const patch = patchSchema.safeParse(value);
    return USER_ID.test(userId) && patch.success ? [[userId, patch.data] as const] : [];
  });
  return { preferences: Object.fromEntries(valid), dropped: entries.length - valid.length };
}

export function resolvePreferences(
  stored: StoredPreferences,
  userId: string,
  defaults: UserPreferences,
): UserPreferences {
  const patch = stored[userId];
  const voice = patch?.voice !== undefined ? findVoice(patch.voice)?.id : undefined;
  return {
    voice: voice ?? defaults.voice,
    announceName: patch?.announceName ?? defaults.announceName,
  };
}

export function withPreference(
  stored: StoredPreferences,
  userId: string,
  patch: PreferencePatch,
): StoredPreferences {
  return { ...stored, [userId]: { ...stored[userId], ...patch } };
}
