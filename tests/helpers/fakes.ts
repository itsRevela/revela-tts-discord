import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  VoiceBasedChannel,
} from 'discord.js';
import { ChannelType } from 'discord.js';
import type { CommandContext } from '../../src/commands/types.ts';
import { parseConfig, type Config } from '../../src/config/config.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import type { ClipPlayer } from '../../src/playback/speechQueue.ts';
import type { GuildSpeaker, GuildSpeakers, SpeakInput, SpeakResult } from '../../src/playback/guildSpeakers.ts';
import type { PreferenceStore } from '../../src/preferences/preferenceStore.ts';
import {
  resolvePreferences,
  withPreference,
  type PreferencePatch,
  type StoredPreferences,
} from '../../src/preferences/userPreferences.ts';
import type { SynthesisRequest, TtsEngine } from '../../src/tts/types.ts';

export const GUILD_ID = '100000000000000001';
export const CHANNEL_ID = '200000000000000001';
export const OTHER_CHANNEL_ID = '200000000000000002';
export const USER_ID = '300000000000000001';
export const BOT_ID = '400000000000000001';

export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({ DISCORD_TOKEN: 'test-token', ...overrides });
}

/** Engine that emits one 24 kHz chunk per "|"-separated part of the text. */
export interface FakeEngine extends TtsEngine {
  readonly requests: SynthesisRequest[];
  failNext: boolean;
  gate: Promise<void> | undefined;
}

export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    requests: [],
    failNext: false,
    gate: undefined,
    synthesize: async (request) => {
      engine.requests.push(request);
      if (engine.failNext) {
        engine.failNext = false;
        throw new Error('synthesis exploded');
      }
      const parts = request.text.split('|');
      for (const [index, part] of parts.entries()) {
        if (request.signal?.aborted) return;
        if (index > 0 && engine.gate) await engine.gate;
        if (request.signal?.aborted) return;
        request.onChunk({ samples: new Float32Array(part.length * 10).fill(0.5), sampleRate: 24_000 });
      }
    },
  };
  return engine;
}

/** Player whose clips finish only when `finishCurrent` is called (or immediately when auto). */
export interface FakePlayer extends ClipPlayer {
  readonly played: Buffer[];
  stops: number;
  finishCurrent(): void;
}

export function fakePlayer(auto = true): FakePlayer {
  let pending: (() => void) | undefined;
  const player: FakePlayer = {
    played: [],
    stops: 0,
    play: (pcm) => {
      player.played.push(pcm);
      if (auto) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending = resolve;
      });
    },
    stop: () => {
      player.stops += 1;
      player.finishCurrent();
    },
    finishCurrent: () => {
      const resolve = pending;
      pending = undefined;
      resolve?.();
    },
  };
  return player;
}

export function memoryPreferences(initial: StoredPreferences = {}): PreferenceStore & { stored: () => StoredPreferences } {
  let state = initial;
  const defaults = { voice: 'af_heart', announceName: true };
  return {
    stored: () => state,
    get: (userId) => resolvePreferences(state, userId, defaults),
    update: async (userId: string, patch: PreferencePatch) => {
      state = withPreference(state, userId, patch);
      return resolvePreferences(state, userId, defaults);
    },
  };
}

export interface FakeSpeaker extends GuildSpeaker {
  readonly spoken: SpeakInput[];
  channelId: string;
  isFull: boolean;
  speakResult: SpeakResult;
  skipped: number;
}

export function fakeSpeaker(channelId = CHANNEL_ID): FakeSpeaker {
  const speaker: FakeSpeaker = {
    spoken: [],
    channelId,
    isFull: false,
    speakResult: 'queued',
    skipped: 0,
    speak: (input) => {
      speaker.spoken.push(input);
      return speaker.speakResult;
    },
    skip: () => {
      speaker.skipped += 1;
      return true;
    },
  };
  return speaker;
}

export interface FakeSpeakers extends GuildSpeakers {
  current: FakeSpeaker | undefined;
  connectError: Error | undefined;
  readonly connected: VoiceBasedChannel[];
  readonly disconnected: string[];
}

export function fakeSpeakers(current?: FakeSpeaker): FakeSpeakers {
  const speakers: FakeSpeakers = {
    current,
    connectError: undefined,
    connected: [],
    disconnected: [],
    get: () => speakers.current,
    connect: async (channel) => {
      speakers.connected.push(channel);
      if (speakers.connectError) throw speakers.connectError;
      speakers.current ??= fakeSpeaker(channel.id);
      return speakers.current;
    },
    disconnect: (guildId) => {
      speakers.disconnected.push(guildId);
      const had = speakers.current !== undefined;
      speakers.current = undefined;
      return had;
    },
    disconnectAll: () => undefined,
  };
  return speakers;
}

export function commandContext(parts: Partial<CommandContext> = {}): CommandContext {
  return {
    config: testConfig(),
    speakers: fakeSpeakers(),
    preferences: memoryPreferences(),
    logger: silentLogger,
    ...parts,
  };
}

export interface ChannelOptions {
  id?: string;
  type?: ChannelType;
  joinable?: boolean;
  permissions?: readonly bigint[] | 'all';
}

export function fakeVoiceChannel(options: ChannelOptions = {}): VoiceBasedChannel {
  const granted = options.permissions ?? 'all';
  return {
    id: options.id ?? CHANNEL_ID,
    type: options.type ?? ChannelType.GuildVoice,
    joinable: options.joinable ?? true,
    guild: { id: GUILD_ID },
    permissionsFor: () => ({ has: (flag: bigint) => granted === 'all' || granted.includes(flag) }),
  } as unknown as VoiceBasedChannel;
}

export interface FakeMemberOptions {
  displayName?: string;
  channel?: VoiceBasedChannel | null;
  canMoveMembers?: boolean;
}

export function fakeMember(options: FakeMemberOptions = {}): GuildMember {
  const channel = options.channel === undefined ? fakeVoiceChannel() : options.channel;
  return {
    displayName: options.displayName ?? 'Alex',
    voice: { channel, channelId: channel?.id ?? null },
    permissions: { has: () => options.canMoveMembers ?? false },
  } as unknown as GuildMember;
}

export interface Reply {
  readonly kind: 'reply' | 'defer' | 'edit';
  readonly payload: unknown;
}

export interface FakeInteractionOptions {
  commandName?: string;
  inGuild?: boolean;
  member?: GuildMember;
  strings?: Record<string, string | null>;
  booleans?: Record<string, boolean | null>;
  username?: string;
}

export type FakeChatInteraction = ChatInputCommandInteraction & {
  readonly replies: Reply[];
  /** How the reply was deleted: "interaction" (deleteReply) or "channel" (message.delete). */
  readonly deletions: string[];
};

export function fakeInteraction(options: FakeInteractionOptions = {}): FakeChatInteraction {
  const replies: Reply[] = [];
  const deletions: string[] = [];
  const member = options.member ?? fakeMember();
  const interaction = {
    replies,
    deletions,
    commandName: options.commandName ?? 'tts',
    guildId: GUILD_ID,
    deferred: false,
    replied: false,
    user: { id: USER_ID, username: options.username ?? 'alex_user' },
    member,
    guild: {
      id: GUILD_ID,
      members: { me: { id: BOT_ID }, cache: new Map(), fetch: async () => undefined },
      roles: { cache: new Map() },
      channels: { cache: new Map() },
      client: { users: { cache: new Map() } },
    },
    inCachedGuild: () => options.inGuild ?? true,
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    options: {
      getString: (name: string) => options.strings?.[name] ?? null,
      getBoolean: (name: string) => options.booleans?.[name] ?? null,
    },
    reply: async (payload: unknown) => {
      replies.push({ kind: 'reply', payload });
      interaction.replied = true;
    },
    deferReply: async (payload: unknown) => {
      replies.push({ kind: 'defer', payload });
      interaction.deferred = true;
    },
    editReply: async (payload: unknown) => {
      replies.push({ kind: 'edit', payload });
      return { delete: async () => { deletions.push('channel'); } };
    },
    deleteReply: async () => {
      deletions.push('interaction');
    },
  };
  return interaction as unknown as FakeChatInteraction;
}

export function fakeAutocomplete(commandName: string, focused: string): AutocompleteInteraction & { responses: unknown[] } {
  const responses: unknown[] = [];
  return {
    responses,
    commandName,
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: { getFocused: () => focused },
    respond: async (choices: unknown) => {
      responses.push(choices);
    },
  } as unknown as AutocompleteInteraction & { responses: unknown[] };
}

/** Text content of a reply payload, whether a string or an options object. */
export function contentOf(reply: Reply | undefined): string {
  const payload = reply?.payload;
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'content' in payload) return String(payload.content);
  return '';
}

export function isEphemeral(reply: Reply | undefined): boolean {
  const payload = reply?.payload;
  return Boolean(payload && typeof payload === 'object' && 'flags' in payload && payload.flags);
}
