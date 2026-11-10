import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  VoiceBasedChannel,
} from 'discord.js';
import { ChannelType } from 'discord.js';
import type { CommandContext } from '../../src/commands/types.ts';
import { parseConfig, type Config } from '../../src/config/config.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import type { SpeechPlayer } from '../../src/playback/speechQueue.ts';
import type { GuildSpeaker, GuildSpeakers, SpeakInput, SpeakResult } from '../../src/playback/guildSpeakers.ts';
import type { ModelSynthesisRequest, Synthesizer } from '../../src/tts/synthesizer.ts';
import { memoryPreferences, testCatalog } from './catalog.ts';
import { fakeUserVoices, memoryModeration } from './userVoices.ts';

export { memoryPreferences, testCatalog } from './catalog.ts';

export const GUILD_ID = '100000000000000001';
export const CHANNEL_ID = '200000000000000001';
export const OTHER_CHANNEL_ID = '200000000000000002';
export const USER_ID = '300000000000000001';
export const BOT_ID = '400000000000000001';

export const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({ DISCORD_TOKEN: 'test-token', ...overrides });
}

/** Synthesizer that emits one 24 kHz chunk per "|"-separated part of the text. */
export interface FakeSynthesizer extends Synthesizer {
  readonly requests: ModelSynthesisRequest[];
  failNext: boolean;
  gate: Promise<void> | undefined;
}

export function fakeSynthesizer(): FakeSynthesizer {
  const synthesizer: FakeSynthesizer = {
    requests: [],
    failNext: false,
    gate: undefined,
    synthesize: async (request) => {
      synthesizer.requests.push(request);
      if (synthesizer.failNext) {
        synthesizer.failNext = false;
        throw new Error('synthesis exploded');
      }
      const parts = request.text.split('|');
      for (const [index, part] of parts.entries()) {
        if (request.signal?.aborted) return;
        if (index > 0 && synthesizer.gate) await synthesizer.gate;
        if (request.signal?.aborted) return;
        request.onChunk({ samples: new Float32Array(part.length * 10).fill(0.5), sampleRate: 24_000 });
      }
    },
  };
  return synthesizer;
}

/** One message handed to the player: its PCM so far and whether the stream ended. */
export interface PlayedMessage {
  readonly chunks: Buffer[];
  ended: boolean;
}

export function bytesOf(message: PlayedMessage | undefined): number {
  return message?.chunks.reduce((total, chunk) => total + chunk.length, 0) ?? 0;
}

/** Auto mode finishes each message when its stream ends; manual mode waits for finishCurrent() or stop(). */
export interface FakePlayer extends SpeechPlayer {
  readonly played: PlayedMessage[];
  stops: number;
  finishCurrent(): void;
}

export function fakePlayer(auto = true): FakePlayer {
  let pending: (() => void) | undefined;
  const player: FakePlayer = {
    played: [],
    stops: 0,
    play: (pcm) => {
      const message: PlayedMessage = { chunks: [], ended: false };
      player.played.push(message);
      return new Promise<void>((resolve) => {
        pending = resolve;
        pcm.on('data', (chunk: Buffer) => message.chunks.push(chunk));
        pcm.on('end', () => {
          message.ended = true;
          if (auto) player.finishCurrent();
        });
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

export interface FakeSpeaker extends GuildSpeaker {
  readonly spoken: SpeakInput[];
  readonly droppedAuthors: string[];
  channelId: string;
  isFull: boolean;
  speakResult: SpeakResult;
  skipped: number;
}

export function fakeSpeaker(channelId = CHANNEL_ID): FakeSpeaker {
  const speaker: FakeSpeaker = {
    spoken: [],
    droppedAuthors: [],
    channelId,
    isFull: false,
    speakResult: 'queued',
    skipped: 0,
    speak: (input) => {
      speaker.spoken.push(input);
      return speaker.speakResult;
    },
    dropAuthor: (authorId) => {
      speaker.droppedAuthors.push(authorId);
      return 0;
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
    catalog: testCatalog(),
    logger: silentLogger,
    userVoices: fakeUserVoices().service,
    moderation: memoryModeration(),
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
  userId?: string;
  username?: string;
  channel?: VoiceBasedChannel | null;
  canMoveMembers?: boolean;
}

export function fakeMember(options: FakeMemberOptions = {}): GuildMember {
  const channel = options.channel === undefined ? fakeVoiceChannel() : options.channel;
  const user = { id: options.userId ?? USER_ID, username: options.username ?? 'alex_user', bot: false };
  return {
    id: user.id,
    user,
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
  subcommand?: string;
  /** Channel options by name. */
  channels?: Record<string, unknown>;
  /** The channel the command was used in. */
  channel?: unknown;
  /** Attachment options by name. */
  attachments?: Record<string, unknown>;
  /** User options by name. */
  users?: Record<string, unknown>;
  /** The invoking user's id. */
  userId?: string;
}

export type FakeChatInteraction = ChatInputCommandInteraction & {
  readonly replies: Reply[];
  /** Pop-up forms shown with showModal. */
  readonly modals: unknown[];
  /** Direct messages sent through interaction.client, as "userId: text". */
  readonly dms: string[];
  /** Messages sent to channels fetched through interaction.client, as "channelId: text". */
  readonly posts: string[];
  /** How the reply was deleted: "interaction" (deleteReply) or "channel" (message.delete). */
  readonly deletions: string[];
};

export function fakeInteraction(options: FakeInteractionOptions = {}): FakeChatInteraction {
  const replies: Reply[] = [];
  const deletions: string[] = [];
  const modals: unknown[] = [];
  const dms: string[] = [];
  const posts: string[] = [];
  const member = options.member ?? fakeMember();
  const interaction = {
    replies,
    deletions,
    modals,
    dms,
    posts,
    client: {
      users: {
        send: async (userId: string, text: string) => {
          dms.push(`${userId}: ${text}`);
        },
      },
      channels: {
        fetch: async (channelId: string) => ({
          isSendable: () => true,
          send: async (message: { content: string }) => {
            posts.push(`${channelId}: ${message.content}`);
          },
        }),
      },
    },
    showModal: async (modal: unknown) => {
      modals.push(modal);
    },
    commandName: options.commandName ?? 'tts',
    guildId: GUILD_ID,
    deferred: false,
    replied: false,
    user: { id: options.userId ?? USER_ID, username: options.username ?? 'alex_user' },
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
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    channel: options.channel ?? null,
    options: {
      getString: (name: string) => options.strings?.[name] ?? null,
      getBoolean: (name: string) => options.booleans?.[name] ?? null,
      getSubcommand: () => options.subcommand ?? '',
      getChannel: (name: string) => options.channels?.[name] ?? null,
      getAttachment: (name: string) => options.attachments?.[name] ?? null,
      getUser: (name: string) => options.users?.[name] ?? null,
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
    user: { id: USER_ID },
    isAutocomplete: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    options: { getFocused: () => focused },
    respond: async (choices: unknown) => {
      responses.push(choices);
    },
  } as unknown as AutocompleteInteraction & { responses: unknown[] };
}

export type FakeComponentInteraction = MessageComponentInteraction & { readonly updates: unknown[]; readonly replies: unknown[] };

/** A picker click: a select menu when `values` is given, otherwise a button. */
export function fakeComponent(customId: string, values?: string[]): FakeComponentInteraction {
  const updates: unknown[] = [];
  const replies: unknown[] = [];
  return {
    updates,
    replies,
    customId,
    values,
    user: { id: USER_ID, username: 'alex_user' },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => values !== undefined,
    isButton: () => values === undefined,
    update: async (payload: unknown) => {
      updates.push(payload);
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
  } as unknown as FakeComponentInteraction;
}

export type FakeModalInteraction = ModalSubmitInteraction & { readonly replies: Reply[] };

/** A submitted pop-up form with text fields and uploaded files by custom id. */
export function fakeModalSubmit(
  customId: string,
  fields: { text?: Record<string, string>; files?: Record<string, unknown[]> } = {},
): FakeModalInteraction {
  const replies: Reply[] = [];
  const interaction = {
    replies,
    customId,
    user: { id: USER_ID, username: 'alex_user' },
    deferred: false,
    replied: false,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => true,
    isChatInputCommand: () => false,
    fields: {
      getTextInputValue: (id: string) => fields.text?.[id] ?? '',
      getUploadedFiles: (id: string) => {
        const files = fields.files?.[id];
        return files ? { first: () => files[0] } : null;
      },
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
    },
  };
  return interaction as unknown as FakeModalInteraction;
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
