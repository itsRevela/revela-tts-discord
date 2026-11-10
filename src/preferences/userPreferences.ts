import { z } from 'zod';

/** What a user's /tts messages sound like, after defaults are applied. */
export interface UserPreferences {
  readonly model: string;
  /** A voice id of `model`. */
  readonly voice: string;
  /** Say "<name> says," before this user's messages when the speaker changes. */
  readonly announceName: boolean;
  /** Whether this user may use custom voices: always, unless they are password-locked and not unlocked. */
  readonly customVoices: boolean;
}

/** Only what a user changed is stored. Voices are remembered per model, so switching back restores them. */
export interface StoredUserPreferences {
  readonly model?: string;
  readonly voices?: Readonly<Record<string, string>>;
  readonly announceName?: boolean;
  /** Set by /unlock with the right password. */
  readonly customVoicesUnlocked?: boolean;
  /** Per server id: the channels whose messages from this user are read aloud. */
  readonly autoRead?: Readonly<Record<string, readonly string[]>>;
}

export interface PreferencePatch {
  readonly model?: string;
  /** Merged into the voices remembered for other models. */
  readonly voices?: Readonly<Record<string, string>>;
  readonly announceName?: boolean;
  readonly customVoicesUnlocked?: boolean;
  /** Per server id: the new channel list, replacing that server's; empty turns auto-read off there. */
  readonly autoRead?: Readonly<Record<string, readonly string[]>>;
}

export type StoredPreferences = Readonly<Record<string, StoredUserPreferences>>;

/** Decides what stored choices mean today, given which models and voices are loaded. */
export interface PreferenceDefaults {
  readonly announceName: boolean;
  /** True when custom voices need /unlock (a password is configured). */
  readonly customVoicesLocked: boolean;
  /** The model to use for a stored choice (unknown or unloaded models fall back). */
  resolveModel(requested: string | undefined): string;
  /** The voice to use with `model` for a stored choice (unknown voices, and custom ones when not allowed, fall back). */
  resolveVoice(model: string, requested: string | undefined, allowCustom: boolean): string;
}

const SNOWFLAKE = /^\d{17,20}$/;
const USER_ID = SNOWFLAKE;
/** Auto-read channels a user may have in one server. */
export const MAX_AUTO_READ_CHANNELS = 10;
/** The first version stored a single Kokoro voice as `voice`. */
const LEGACY_VOICE_MODEL = 'kokoro';

const entrySchema = z.object({
  model: z.string().min(1).optional(),
  voices: z.record(z.string(), z.string()).optional(),
  announceName: z.boolean().optional(),
  customVoicesUnlocked: z.boolean().optional(),
  autoRead: z
    .record(z.string().regex(SNOWFLAKE), z.array(z.string().regex(SNOWFLAKE)).min(1).max(MAX_AUTO_READ_CHANNELS))
    .optional(),
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
  const customVoices = !defaults.customVoicesLocked || entry?.customVoicesUnlocked === true;
  return {
    model,
    voice: defaults.resolveVoice(model, entry?.voices?.[model], customVoices),
    announceName: entry?.announceName ?? defaults.announceName,
    customVoices,
  };
}

/** The channels in `guildId` whose messages from `userId` are read aloud. */
export function autoReadChannelsOf(stored: StoredPreferences, userId: string, guildId: string): readonly string[] {
  return stored[userId]?.autoRead?.[guildId] ?? [];
}

/** Applies per-server channel lists; a server with no channels left is dropped. */
function mergeAutoRead(
  current: Readonly<Record<string, readonly string[]>> | undefined,
  patch: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> | undefined {
  const entries = Object.entries({ ...current, ...patch }).filter(([, channels]) => channels.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Merges a patch, keeping the voices remembered for other models and other servers' auto-read channels. */
export function withPreference(
  stored: StoredPreferences,
  userId: string,
  patch: PreferencePatch,
): StoredPreferences {
  const { voices: currentVoices, autoRead: currentAutoRead, ...currentRest } = stored[userId] ?? {};
  const { voices: voicesPatch, autoRead: autoReadPatch, ...restPatch } = patch;
  const voices = voicesPatch ? { ...currentVoices, ...voicesPatch } : currentVoices;
  const autoRead = autoReadPatch ? mergeAutoRead(currentAutoRead, autoReadPatch) : currentAutoRead;
  const next: StoredUserPreferences = {
    ...currentRest,
    ...restPatch,
    ...(voices ? { voices } : {}),
    ...(autoRead ? { autoRead } : {}),
  };
  return { ...stored, [userId]: next };
}
