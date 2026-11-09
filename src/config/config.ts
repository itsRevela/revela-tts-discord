import { LOG_LEVELS, type LogLevel } from '../logging/logger.ts';
import { DEFAULT_VOICE_ID, findVoice } from '../tts/voices.ts';

export interface Config {
  readonly discordToken: string;
  /** When set, slash commands register to this guild only (instant updates while testing). */
  readonly guildId: string | undefined;
  readonly modelDir: string;
  readonly ttsThreads: number;
  readonly ttsSpeed: number;
  readonly defaultVoice: string;
  readonly maxTextLength: number;
  readonly maxQueueLength: number;
  /** 0 disables the idle timeout. */
  readonly idleTimeoutMs: number;
  /** Delete public /tts replies after this long; 0 keeps them. */
  readonly replyDeleteMs: number;
  readonly dataDir: string;
  readonly logLevel: LogLevel;
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

export function parseConfig(env: Env): Config {
  const problems: string[] = [];

  const discordToken = readText(env, 'DISCORD_TOKEN');
  if (!discordToken) problems.push('DISCORD_TOKEN is required');

  const guildId = readText(env, 'DISCORD_GUILD_ID');
  if (guildId !== undefined && !SNOWFLAKE.test(guildId)) {
    problems.push(`DISCORD_GUILD_ID must be a Discord server id (got "${guildId}")`);
  }

  const defaultVoice = readText(env, 'DEFAULT_VOICE') ?? DEFAULT_VOICE_ID;
  if (!findVoice(defaultVoice)) problems.push(`DEFAULT_VOICE "${defaultVoice}" is not a known English Kokoro voice`);

  const rawLevel = readText(env, 'LOG_LEVEL') ?? 'info';
  const logLevel = LOG_LEVELS.find((level) => level === rawLevel.toLowerCase());
  if (!logLevel) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${rawLevel}")`);

  const config: Config = {
    discordToken: discordToken ?? '',
    guildId,
    modelDir: readText(env, 'KOKORO_MODEL_DIR') ?? '/models/kokoro',
    ttsThreads: readNumber(env, 'TTS_THREADS', { fallback: 4, min: 1, max: 32, integer: true }, problems),
    ttsSpeed: readNumber(env, 'TTS_SPEED', { fallback: 1, min: 0.5, max: 2, integer: false }, problems),
    defaultVoice: findVoice(defaultVoice)?.id ?? DEFAULT_VOICE_ID,
    maxTextLength: readNumber(env, 'MAX_TEXT_LENGTH', { fallback: 300, min: 1, max: 1000, integer: true }, problems),
    maxQueueLength: readNumber(env, 'MAX_QUEUE_LENGTH', { fallback: 10, min: 1, max: 100, integer: true }, problems),
    idleTimeoutMs: readNumber(env, 'IDLE_TIMEOUT_MINUTES', { fallback: 15, min: 0, max: 1440, integer: false }, problems) * 60_000,
    replyDeleteMs: readNumber(env, 'REPLY_DELETE_MINUTES', { fallback: 5, min: 0, max: 1440, integer: false }, problems) * 60_000,
    dataDir: readText(env, 'DATA_DIR') ?? '/data',
    logLevel: logLevel ?? 'info',
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return Object.freeze(config);
}
