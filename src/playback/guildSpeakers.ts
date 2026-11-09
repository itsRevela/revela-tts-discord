import type { VoiceBasedChannel } from 'discord.js';
import type { Logger } from '../logging/logger.ts';
import type { TtsEngine } from '../tts/types.ts';
import { createGuildSpeaker, type GuildSpeaker, type GuildSpeakerHandle } from './guildSpeaker.ts';
import { openVoiceSession, type OpenVoiceSession, type VoiceSession } from './voiceSession.ts';

export type { GuildSpeaker, SpeakInput, SpeakResult } from './guildSpeaker.ts';

/** Registry of the bot's voice presence, at most one channel per guild. */
export interface GuildSpeakers {
  get(guildId: string): GuildSpeaker | undefined;
  /** Joins the channel, or returns the existing speaker for the guild. */
  connect(channel: VoiceBasedChannel): Promise<GuildSpeaker>;
  disconnect(guildId: string): boolean;
  disconnectAll(): void;
}

export interface GuildSpeakersOptions {
  readonly engine: TtsEngine;
  readonly logger: Logger;
  readonly maxQueueLength: number;
  /** Leave after this long without new messages; 0 never leaves. */
  readonly idleTimeoutMs: number;
  readonly openSession?: OpenVoiceSession;
}

interface Entry extends GuildSpeakerHandle {
  readonly session: VoiceSession;
}

function without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  return new Map([...map].filter(([candidate]) => candidate !== key));
}

export function createGuildSpeakers(options: GuildSpeakersOptions): GuildSpeakers {
  const { logger } = options;
  const openSession = options.openSession ?? openVoiceSession;
  let entries: ReadonlyMap<string, Entry> = new Map();
  let pending: ReadonlyMap<string, Promise<Entry>> = new Map();

  const teardown = (guildId: string, entry: Entry): void => {
    entry.close();
    if (entries.get(guildId) === entry) entries = without(entries, guildId);
  };

  async function createEntry(channel: VoiceBasedChannel): Promise<Entry> {
    const guildId = channel.guild.id;
    let entry: Entry | undefined;
    let closedEarly = false;
    const session = await openSession({
      channel,
      logger,
      onClosed: () => {
        if (entry) teardown(guildId, entry);
        else closedEarly = true;
      },
    });
    if (closedEarly) throw new Error(`Voice connection in guild ${guildId} closed while joining`);
    entry = { ...createGuildSpeaker({ ...options, session }), session };
    return entry;
  }

  async function connect(channel: VoiceBasedChannel): Promise<GuildSpeaker> {
    const guildId = channel.guild.id;
    const existing = entries.get(guildId);
    if (existing) return existing.speaker;
    const inFlight = pending.get(guildId);
    if (inFlight) return (await inFlight).speaker;

    const attempt = createEntry(channel);
    pending = new Map(pending).set(guildId, attempt);
    try {
      const entry = await attempt;
      entries = new Map(entries).set(guildId, entry);
      logger.info('Joined voice channel', { guildId, channelId: channel.id });
      return entry.speaker;
    } finally {
      pending = without(pending, guildId);
    }
  }

  function disconnect(guildId: string): boolean {
    const entry = entries.get(guildId);
    if (!entry) return false;
    teardown(guildId, entry);
    entry.session.destroy();
    logger.info('Left voice channel', { guildId });
    return true;
  }

  return {
    get: (guildId) => entries.get(guildId)?.speaker,
    connect,
    disconnect,
    disconnectAll: () => {
      for (const guildId of entries.keys()) disconnect(guildId);
    },
  };
}
