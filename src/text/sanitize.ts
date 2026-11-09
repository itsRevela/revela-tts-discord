/** Looks up display names for Discord mentions found in a message. */
export interface MentionResolver {
  user(id: string): string | undefined;
  role(id: string): string | undefined;
  channel(id: string): string | undefined;
}

export const NO_MENTIONS: MentionResolver = {
  user: () => undefined,
  role: () => undefined,
  channel: () => undefined,
};

export const USER_MENTION = /<@!?(\d+)>/g;
export const ROLE_MENTION = /<@&(\d+)>/g;
export const CHANNEL_MENTION = /<#(\d+)>/g;

const MAX_REPEATED_CHARACTERS = 3;
const ENDS_WITH_PUNCTUATION = /[.!?,;:]$/;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F​-‏⁠﻿]/g;
const CODE_BLOCK = /```[\s\S]*?```/g;
const SPOILER = /\|\|[\s\S]*?\|\|/g;
const SLASH_COMMAND_MENTION = /<\/([\w -]+):\d+>/g;
const CUSTOM_EMOJI = /<a?:(\w+):\d+>/g;
const TIMESTAMP = /<t:-?\d+(?::[tTdDfFR])?>/g;
const URL = /\bhttps?:\/\/\S+/gi;
const LINE_PREFIX = /^[ \t]*(?:#{1,3}|-#|>{1,3})[ \t]+/gm;
const MARKDOWN_SYMBOLS = /[*_~`|]+/g;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const REPEATED_CHARACTER = /(\S)\1{3,}/gu;

function replaceDiscordTokens(text: string, resolve: MentionResolver): string {
  return text
    .replace(CODE_BLOCK, ' code block ')
    .replace(SPOILER, ' spoiler ')
    .replace(ROLE_MENTION, (_match, id: string) => ` ${resolve.role(id) ?? 'a role'} `)
    .replace(USER_MENTION, (_match, id: string) => ` ${resolve.user(id) ?? 'someone'} `)
    .replace(CHANNEL_MENTION, (_match, id: string) => ` ${resolve.channel(id) ?? 'a channel'} `)
    .replace(SLASH_COMMAND_MENTION, (_match, name: string) => ` ${name} `)
    .replace(CUSTOM_EMOJI, (_match, name: string) => ` ${name.replace(/_/g, ' ')} `)
    .replace(TIMESTAMP, ' a timestamp ')
    .replace(URL, ' a link ');
}

function stripFormatting(text: string): string {
  return text
    .replace(LINE_PREFIX, '')
    .replace(MARKDOWN_SYMBOLS, ' ')
    .replace(EMOJI, ' ')
    .replace(REPEATED_CHARACTER, (_match, char: string) => char.repeat(MAX_REPEATED_CHARACTERS));
}

/** Separate lines become sentences so the voice pauses between them. */
function joinLines(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').replace(/ ([,.!?;:])/g, '$1').trim())
    .filter(Boolean);
  return lines
    .map((line, index) => (index < lines.length - 1 && !ENDS_WITH_PUNCTUATION.test(line) ? `${line}.` : line))
    .join(' ');
}

/**
 * Turns raw Discord message text into something worth reading aloud: mentions
 * become names, links and code are summarized, emoji and markdown are dropped.
 * Returns an empty string when nothing speakable is left.
 */
export function sanitizeForSpeech(raw: string, resolve: MentionResolver = NO_MENTIONS): string {
  const normalized = raw.normalize('NFKC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '');
  const text = joinLines(stripFormatting(replaceDiscordTokens(normalized, resolve)));
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}
