import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { buildMentionResolver } from '../discord/mentionResolver.ts';
import { createLoadingReply } from '../loading/loadingReply.ts';
import { createReplyCleanup, scheduleReplyDeletion, type DeletableReply, type ReplyCleanup } from '../discord/replyCleanup.ts';
import { preflight } from '../speech/preflight.ts';
import { speakForMember, type SpeechCallbacks } from '../speech/speakForMember.ts';
import { sanitizeForSpeech } from '../text/sanitize.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

/** A problem reply has no speech to wait for, so it stays this long to be read. */
export const PROBLEM_REPLY_MS = 15_000;

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
  const problem = await speakForMember(interaction.member, check.channel, spoken, callbacks, context);
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
