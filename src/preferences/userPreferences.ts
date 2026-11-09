import { z } from 'zod';

/** What a user's /tts messages sound like, after defaults are applied. */
export interface UserPreferences {
  readonly model: string;
  /** A voice id of `model`. */
  readonly voice: string;
  /** Say "<name> says," before this user's messages when the speaker changes. */
  readonly announceName: boolean;
}

/** Only what a user changed is stored. Voices are remembered per model, so switching back restores them. */
export interface StoredUserPreferences {
  readonly model?: string;
  readonly voices?: Readonly<Record<string, string>>;
  readonly announceName?: boolean;
}

export type PreferencePatch = StoredUserPreferences;

export type StoredPreferences = Readonly<Record<string, StoredUserPreferences>>;

/** Decides what stored choices mean today, given which models and voices are loaded. */
export interface PreferenceDefaults {
  readonly announceName: boolean;
  /** The model to use for a stored choice (unknown or unloaded models fall back). */
  resolveModel(requested: string | undefined): string;
  /** The voice to use with `model` for a stored choice (unknown voices fall back). */
  resolveVoice(model: string, requested: string | undefined): string;
}

const USER_ID = /^\d{17,20}$/;
/** The first version stored a single Kokoro voice as `voice`. */
const LEGACY_VOICE_MODEL = 'kokoro';

const entrySchema = z.object({
  model: z.string().min(1).optional(),
  voices: z.record(z.string(), z.string()).optional(),
  announceName: z.boolean().optional(),
  voice: z.string().min(1).optional(),
});

const fileSchema = z.record(z.string(), z.unknown());

export interface ParsedPreferences {
  readonly preferences: StoredPreferences;
  /** Entries skipped because the user id or values were invalid. */
  readonly dropped: number;
}

/** Someone who picked a voice in the single-model version chose Kokoro, so they stay on it. */
function toStored(entry: z.infer<typeof entrySchema>): StoredUserPreferences {
  const { voice: legacyVoice, voices, ...rest } = entry;
  if (!legacyVoice) return voices ? { ...rest, voices } : rest;
  return {
    ...rest,
    model: rest.model ?? LEGACY_VOICE_MODEL,
    voices: { [LEGACY_VOICE_MODEL]: legacyVoice, ...voices },
  };
}

/**
 * Validates untrusted file content entry by entry, keeping every valid entry
 * and upgrading the old single-voice format. Whether a stored model or voice
 * still exists is decided later, when preferences are resolved.
 */
export function parseStoredPreferences(json: unknown): ParsedPreferences {
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new Error('Preferences file must contain a JSON object');
  const entries = Object.entries(file.data);
  const valid = entries.flatMap(([userId, value]) => {
    const entry = entrySchema.safeParse(value);
    return USER_ID.test(userId) && entry.success ? [[userId, toStored(entry.data)] as const] : [];
  });
  return { preferences: Object.fromEntries(valid), dropped: entries.length - valid.length };
}

export function resolvePreferences(
  stored: StoredPreferences,
  userId: string,
  defaults: PreferenceDefaults,
): UserPreferences {
  const entry = stored[userId];
  const model = defaults.resolveModel(entry?.model);
  return {
    model,
    voice: defaults.resolveVoice(model, entry?.voices?.[model]),
    announceName: entry?.announceName ?? defaults.announceName,
  };
}

/** Merges a patch, keeping the voices remembered for other models. */
export function withPreference(
  stored: StoredPreferences,
  userId: string,
  patch: PreferencePatch,
): StoredPreferences {
  const current = stored[userId] ?? {};
  const voices = patch.voices ? { ...current.voices, ...patch.voices } : current.voices;
  const merged = { ...current, ...patch };
  return { ...stored, [userId]: voices ? { ...merged, voices } : merged };
}
