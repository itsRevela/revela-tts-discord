import {
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Message,
  type VoiceBasedChannel,
} from 'discord.js';
import { buildMentionResolver } from '../discord/mentionResolver.ts';
import { createLoadingReply } from '../loading/loadingReply.ts';
import type { SpeechStatus } from '../playback/speechStatus.ts';
import { createReplyCleanup, scheduleReplyDeletion, type DeletableReply, type ReplyCleanup } from '../discord/replyCleanup.ts';
import type { GuildSpeaker, GuildSpeakers } from '../playback/guildSpeakers.ts';
import { sanitizeForSpeech } from '../text/sanitize.ts';
import { speakableName } from '../text/speakableName.ts';
import { replyEphemeral, voiceChannelProblem } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

const QUEUE_FULL = 'The speech queue is full. Give it a moment to catch up.';
/** A problem reply has no speech to wait for, so it stays this long to be read. */
export const PROBLEM_REPLY_MS = 15_000;

type Preflight = { readonly problem: string } | { readonly channel: VoiceBasedChannel };

function busyElsewhere(channelId: string): string {
  return `I'm already talking in <#${channelId}>. Join that channel, or use /leave there first.`;
}

/** Checks everything that can be answered instantly, before any slow work. */
function preflight(member: GuildMember, guild: Guild, speakers: GuildSpeakers): Preflight {
  const channel = member.voice.channel;
  if (!channel) return { problem: 'Join a voice channel first, then use /tts.' };
  const existing = speakers.get(guild.id);
  if (existing && existing.channelId !== channel.id) return { problem: busyElsewhere(existing.channelId) };
  if (existing?.isFull) return { problem: QUEUE_FULL };
  const problem = existing ? undefined : voiceChannelProblem(channel, guild.members.me);
  return problem ? { problem } : { channel };
}

interface SpeechCallbacks {
  readonly onDone: () => void;
  readonly onStatus: (status: SpeechStatus) => void;
}

/** Joins (if needed) and queues the speech. Returns a problem to report instead, if any. */
async function speakInChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  channel: VoiceBasedChannel,
  spoken: string,
  callbacks: SpeechCallbacks,
  context: CommandContext,
): Promise<string | undefined> {
  let speaker: GuildSpeaker;
  try {
    speaker = await context.speakers.connect(channel);
  } catch (error: unknown) {
    context.logger.error('Failed to join voice channel', { error, guildId: channel.guild.id, channelId: channel.id });
    return "I couldn't join the voice channel. Try again in a moment.";
  }
  if (speaker.channelId !== channel.id) return busyElsewhere(speaker.channelId);

  const { user, member } = interaction;
  const preferences = context.preferences.get(user.id);
  const result = speaker.speak({
    authorId: user.id,
    authorName: speakableName(member.displayName) ?? speakableName(user.username),
    announceName: preferences.announceName,
    text: spoken,
    model: preferences.model,
    voiceId: preferences.voice,
    ...callbacks,
  });
  return result === 'full' ? QUEUE_FULL : undefined;
}

/** Replaces the reply's text, pinging no one. */
const editReplyText = (interaction: ChatInputCommandInteraction<'cached'>, content: string): Promise<Message<true>> =>
  interaction.editReply({ content, allowedMentions: { parse: [] } });

/**
 * Arranges a posted reply's deletion. With delete-after-playback on, a speech
 * reply goes once its message is done (played, skipped, or dropped when the
 * bot leaves or disconnects), and a problem reply after PROBLEM_REPLY_MS. The
 * optional timer applies to both.
 */
function arrangeDeletion(
  interaction: ChatInputCommandInteraction<'cached'>,
  message: Message<true>,
  cleanup: ReplyCleanup | undefined,
  context: CommandContext,
): void {
  const reply: DeletableReply = { deleteViaInteraction: () => interaction.deleteReply(), deleteViaChannel: () => message.delete() };
  scheduleReplyDeletion(reply, context.config.replyDeleteMs, context.logger);
  if (!context.config.replyDeleteAfterPlayback) return;
  if (cleanup) cleanup.posted(reply);
  else scheduleReplyDeletion(reply, PROBLEM_REPLY_MS, context.logger);
}

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, 'Use /tts in a server.');
    return;
  }
  const check = preflight(interaction.member, interaction.guild, context.speakers);
  if ('problem' in check) {
    await replyEphemeral(interaction, check.problem);
    return;
  }
  const raw = interaction.options.getString('text', true);
  const spoken = sanitizeForSpeech(raw, await buildMentionResolver(interaction.guild, raw));
  if (!spoken) {
    await replyEphemeral(interaction, "There's nothing in that message I can read aloud.");
    return;
  }
  // Discord shows "thinking…" until the first edit; slow models then get a progress line.
  await interaction.deferReply();
  const cleanup = createReplyCleanup(context.logger);
  const loading = createLoadingReply({
    content: `🔊 ${raw}`,
    edit: (content) => editReplyText(interaction, content),
    onPosted: (message) => arrangeDeletion(interaction, message, cleanup, context),
    logger: context.logger,
  });
  const callbacks: SpeechCallbacks = {
    onStatus: (status) => loading.update(status),
    onDone: () => {
      loading.finish();
      cleanup.done();
    },
  };
  const problem = await speakInChannel(interaction, check.channel, spoken, callbacks, context);
  if (problem) {
    loading.cancel();
    arrangeDeletion(interaction, await editReplyText(interaction, problem), undefined, context);
  }
}

export function createTtsCommand(maxTextLength: number): SlashCommand {
  const data = new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Read a message aloud in your voice channel')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('text').setDescription('What to say').setRequired(true).setMaxLength(maxTextLength),
    )
    .toJSON();
  return { data, execute };
}
