import type { GuildMember, Message } from 'discord.js';
import { buildMentionResolver } from '../discord/mentionResolver.ts';
import { preflight } from '../speech/preflight.ts';
import { speakForMember, type SpeakDependencies } from '../speech/speakForMember.ts';
import { sanitizeForSpeech } from '../text/sanitize.ts';
import { truncateAtWord } from '../text/truncate.ts';
import { PROGRESS_REACTION, createReactionProgress } from './reactionProgress.ts';

export interface AutoReadDependencies extends SpeakDependencies {
  /** Longer messages are read up to this many characters, like the /tts limit. */
  readonly maxTextLength: number;
}

/** Only people's own messages in a server; never bots, webhooks or system notices. */
function isPersonMessage(message: Message): message is Message<true> {
  return message.inGuild() && !message.author.bot && !message.system && message.webhookId === null;
}

async function authorMember(message: Message<true>): Promise<GuildMember | undefined> {
  if (message.member) return message.member;
  return message.guild.members.fetch(message.author.id).catch(() => undefined);
}

/**
 * Reads a message aloud as if its author had used /tts, when they turned
 * auto-read on for that channel. Messages are never deleted; when speech is
 * slow to start, a reaction shows it is being generated. Anything that would
 * make /tts reply with a problem (not in a voice channel, bot busy elsewhere,
 * queue full) skips the message quietly, since it was ordinary chat.
 */
export async function handleAutoReadMessage(message: Message, dependencies: AutoReadDependencies): Promise<void> {
  if (!isPersonMessage(message)) return;
  const { preferences, speakers, logger } = dependencies;
  if (!preferences.autoReadChannels(message.author.id, message.guildId).includes(message.channelId)) return;

  const member = await authorMember(message);
  if (!member) return;
  const check = preflight(member, message.guild, speakers);
  if ('problem' in check) {
    logger.debug('Auto-read skipped a message', { guildId: message.guildId, reason: check.problem });
    return;
  }
  const raw = truncateAtWord(message.content, dependencies.maxTextLength);
  const spoken = sanitizeForSpeech(raw, await buildMentionResolver(message.guild, raw));
  if (!spoken) return;

  const progress = createReactionProgress({
    add: () => message.react(PROGRESS_REACTION),
    remove: (reaction) => reaction.users.remove(),
    logger,
  });
  const problem = await speakForMember(
    member,
    check.channel,
    spoken,
    { onStatus: (status) => progress.update(status), onDone: () => progress.finish() },
    dependencies,
  );
  if (problem) {
    progress.finish();
    logger.debug('Auto-read could not queue a message', { guildId: message.guildId, reason: problem });
  }
}
