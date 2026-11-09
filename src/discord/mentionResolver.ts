import type { Guild } from 'discord.js';
import { USER_MENTION, type MentionResolver } from '../text/sanitize.ts';
import { speakableName } from '../text/speakableName.ts';

/** Caps member lookups so one message cannot trigger a burst of API calls. */
const MAX_MEMBER_LOOKUPS = 5;
/** Stay well inside Discord's 3 s window for answering an interaction. */
export const LOOKUP_TIMEOUT_MS = 1_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export function mentionedIds(text: string, pattern: RegExp): readonly string[] {
  const ids = [...text.matchAll(pattern)].map((match) => match[1]).filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

/**
 * Builds a resolver for the mentions in `text`, fetching uncached members first
 * so mentions of people who haven't been seen yet still read as names.
 */
export async function buildMentionResolver(guild: Guild, text: string): Promise<MentionResolver> {
  const uncached = mentionedIds(text, USER_MENTION)
    .filter((id) => !guild.members.cache.has(id))
    .slice(0, MAX_MEMBER_LOOKUPS);
  // Lookups that miss the deadline just read as "someone".
  await Promise.race([Promise.allSettled(uncached.map((id) => guild.members.fetch(id))), delay(LOOKUP_TIMEOUT_MS)]);
  return {
    user: (id) => speakableName(guild.members.cache.get(id)?.displayName ?? guild.client.users.cache.get(id)?.displayName),
    role: (id) => speakableName(guild.roles.cache.get(id)?.name),
    channel: (id) => speakableName(guild.channels.cache.get(id)?.name),
  };
}
