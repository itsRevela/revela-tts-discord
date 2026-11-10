import { LOG_LEVELS, type LogLevel } from '../logging/logger.ts';
import { MODEL_IDS, findModelDefinition } from '../tts/modelRegistry.ts';

/** Voices users upload with /myvoices and share as community voices. */
export interface UserVoiceSettings {
  /** USER_VOICE_UPLOADS=false stops new uploads and publishing; existing voices keep working. */
  readonly uploadsEnabled: boolean;
  readonly maxPerUser: number;
  readonly maxTotal: number;
  readonly maxBytes: number;
  /** Upload attempts allowed per user every 10 minutes. */
  readonly uploadsPerWindow: number;
}

export interface Config {
  readonly discordToken: string;
  /** When set, slash commands register to this guild only (instant updates while testing). */
  readonly guildId: string | undefined;
  /** Each model loads from <modelsDir>/<model id>. */
  readonly modelsDir: string;
  /** Models to load, in the order /voice lists them. */
  readonly models: readonly string[];
  /** Model for users who haven't picked one; always one of `models`. */
  readonly defaultModel: string;
  /** Voice of the default model for users who haven't picked one; undefined uses the model's own default. */
  readonly defaultVoice: string | undefined;
  readonly ttsThreads: number;
  readonly ttsSpeed: number;
  readonly maxTextLength: number;
  readonly maxQueueLength: number;
  /** 0 disables the idle timeout. */
  readonly idleTimeoutMs: number;
  /** Delete each /tts reply once its message has played, been skipped, or been dropped (default on). */
  readonly replyDeleteAfterPlayback: boolean;
  /** When set, custom voices need /unlock with this password. Never logged. */
  readonly customVoicesPassword: string | undefined;
  /** Also delete /tts replies after this long; 0 turns the timer off (the default). */
  readonly replyDeleteMs: number;
  readonly dataDir: string;
  readonly logLevel: LogLevel;
  readonly userVoices: UserVoiceSettings;
  /** Discord user ids allowed to moderate community voices (/voicemod). */
  readonly ownerUserIds: readonly string[];
  /** Where community voice reports are posted, if set. */
  readonly modLogChannelId: string | undefined;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const SNOWFLAKE = /^\d{17,20}$/;

interface NumberRule {
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
}

function readText(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function readBoolean(env: Env, key: string, fallback: boolean, problems: string[]): boolean {
  const raw = readText(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  problems.push(`${key} must be true or false (got "${raw}")`);
  return fallback;
}

function readNumber(env: Env, key: string, rule: NumberRule, problems: string[]): number {
  const raw = readText(env, key);
  if (raw === undefined) return rule.fallback;
  const value = Number(raw);
  const valid = Number.isFinite(value)
    && (!rule.integer || Number.isInteger(value))
    && value >= rule.min
    && value <= rule.max;
  if (!valid) {
    const kind = rule.integer ? 'an integer' : 'a number';
    problems.push(`${key} must be ${kind} from ${rule.min} to ${rule.max} (got "${raw}")`);
    return rule.fallback;
  }
  return value;
}

interface ModelSettings {
  readonly models: readonly string[];
  readonly defaultModel: string;
  readonly defaultVoice: string | undefined;
}

const PREFERRED_DEFAULT_MODEL = 'phonon';

/** TTS_MODELS, DEFAULT_MODEL and DEFAULT_VOICE, checked against the model registry. */
function readModels(env: Env, problems: string[]): ModelSettings {
  const requested = (readText(env, 'TTS_MODELS') ?? MODEL_IDS.join(','))
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((id) => !MODEL_IDS.includes(id));
  if (unknown.length > 0) problems.push(`TTS_MODELS has unknown models: ${unknown.join(', ')} (known: ${MODEL_IDS.join(', ')})`);
  const known = [...new Set(requested.filter((id) => MODEL_IDS.includes(id)))];
  if (requested.length === 0) problems.push('TTS_MODELS must list at least one model');
  const models = known.length > 0 ? known : [PREFERRED_DEFAULT_MODEL];

  const rawDefault = readText(env, 'DEFAULT_MODEL')?.toLowerCase();
  if (rawDefault !== undefined && !models.includes(rawDefault)) {
    problems.push(`DEFAULT_MODEL "${rawDefault}" must be one of TTS_MODELS (${models.join(', ')})`);
  }
  const fallbackDefault = models.includes(PREFERRED_DEFAULT_MODEL) ? PREFERRED_DEFAULT_MODEL : models[0] ?? PREFERRED_DEFAULT_MODEL;
  const defaultModel = rawDefault !== undefined && models.includes(rawDefault) ? rawDefault : fallbackDefault;

  const rawVoice = readText(env, 'DEFAULT_VOICE');
  const definition = findModelDefinition(defaultModel);
  // A server-backed model's voices are only known once its server answers; an unknown voice falls back then.
  const defaultVoice = definition?.remote
    ? rawVoice
    : definition?.voices.find((voice) => voice.id.toLowerCase() === rawVoice?.toLowerCase())?.id;
  if (rawVoice !== undefined && defaultVoice === undefined) {
    problems.push(`DEFAULT_VOICE "${rawVoice}" is not a built-in voice of the default model (${defaultModel})`);
  }
  return { models, defaultModel, defaultVoice };
}

function readSnowflake(env: Env, key: string, problems: string[]): string | undefined {
  const value = readText(env, key);
  if (value !== undefined && !SNOWFLAKE.test(value)) problems.push(`${key} must be a Discord id (got "${value}")`);
  return value !== undefined && SNOWFLAKE.test(value) ? value : undefined;
}

function readSnowflakeList(env: Env, key: string, problems: string[]): readonly string[] {
  const ids = (readText(env, key) ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const invalid = ids.filter((id) => !SNOWFLAKE.test(id));
  if (invalid.length > 0) problems.push(`${key} must list Discord user ids (got "${invalid.join(', ')}")`);
  return Object.freeze([...new Set(ids.filter((id) => SNOWFLAKE.test(id)))]);
}

function readUserVoices(env: Env, problems: string[]): UserVoiceSettings {
  const integer = (key: string, fallback: number, max: number): number =>
    readNumber(env, key, { fallback, min: 1, max, integer: true }, problems);
  return Object.freeze({
    uploadsEnabled: readBoolean(env, 'USER_VOICE_UPLOADS', true, problems),
    maxPerUser: integer('USER_VOICE_MAX_PER_USER', 5, 50),
    maxTotal: integer('USER_VOICE_MAX_TOTAL', 200, 5000),
    maxBytes: integer('USER_VOICE_MAX_MB', 10, 25) * 1024 * 1024,
    uploadsPerWindow: integer('USER_VOICE_UPLOADS_PER_WINDOW', 3, 50),
  });
}

export function parseConfig(env: Env): Config {
  const problems: string[] = [];

  const discordToken = readText(env, 'DISCORD_TOKEN');
  if (!discordToken) problems.push('DISCORD_TOKEN is required');

  const guildId = readText(env, 'DISCORD_GUILD_ID');
  if (guildId !== undefined && !SNOWFLAKE.test(guildId)) {
    problems.push(`DISCORD_GUILD_ID must be a Discord server id (got "${guildId}")`);
  }

  const { models, defaultModel, defaultVoice } = readModels(env, problems);

  const rawLevel = readText(env, 'LOG_LEVEL') ?? 'info';
  const logLevel = LOG_LEVELS.find((level) => level === rawLevel.toLowerCase());
  if (!logLevel) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${rawLevel}")`);

  const config: Config = {
    discordToken: discordToken ?? '',
    guildId,
    modelsDir: readText(env, 'MODELS_DIR') ?? '/models',
    models,
    defaultModel,
    defaultVoice,
    ttsThreads: readNumber(env, 'TTS_THREADS', { fallback: 4, min: 1, max: 32, integer: true }, problems),
    ttsSpeed: readNumber(env, 'TTS_SPEED', { fallback: 1, min: 0.5, max: 2, integer: false }, problems),
    maxTextLength: readNumber(env, 'MAX_TEXT_LENGTH', { fallback: 300, min: 1, max: 1000, integer: true }, problems),
    maxQueueLength: readNumber(env, 'MAX_QUEUE_LENGTH', { fallback: 10, min: 1, max: 100, integer: true }, problems),
    idleTimeoutMs: readNumber(env, 'IDLE_TIMEOUT_MINUTES', { fallback: 15, min: 0, max: 1440, integer: false }, problems) * 60_000,
    replyDeleteAfterPlayback: readBoolean(env, 'REPLY_DELETE_AFTER_PLAYBACK', true, problems),
    customVoicesPassword: readText(env, 'CUSTOM_VOICES_PASSWORD'),
    replyDeleteMs: readNumber(env, 'REPLY_DELETE_MINUTES', { fallback: 0, min: 0, max: 1440, integer: false }, problems) * 60_000,
    dataDir: readText(env, 'DATA_DIR') ?? '/data',
    logLevel: logLevel ?? 'info',
    userVoices: readUserVoices(env, problems),
    ownerUserIds: readSnowflakeList(env, 'OWNER_USER_IDS', problems),
    modLogChannelId: readSnowflake(env, 'MOD_LOG_CHANNEL_ID', problems),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(config);
}
