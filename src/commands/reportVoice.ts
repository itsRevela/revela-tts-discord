import {
  InteractionContextType,
  SlashCommandBuilder,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createAttemptLimiter, type AttemptLimiter } from '../unlock/attemptLimiter.ts';
import { parseUserVoiceKey } from '../userVoices/ids.ts';
import { communityEntries, matchCommunity } from './communityVoices.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import { entryLabel, entryValue } from '../tts/voiceDirectory.ts';

/** Reports per person every 10 minutes, so the mod channel can't be flooded. */
export const REPORTS_PER_WINDOW = 5;

/** The voice id in a picked value such as "pocket:user:<id>". */
const voiceIdOf = (value: string): string | undefined => parseUserVoiceKey(value.replace(/^[a-z]+:/, ''));

async function postToModLog(interaction: ChatInputCommandInteraction, context: CommandContext, content: string): Promise<void> {
  const channelId = context.config.modLogChannelId;
  if (!channelId) {
    context.logger.warn('Community voice reported', { content });
    return;
  }
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (channel?.isSendable()) {
    await channel.send({ content, allowedMentions: { parse: [] } });
  } else {
    context.logger.warn('Could not post a voice report to MOD_LOG_CHANNEL_ID', { channelId, content });
  }
}

export function createReportVoiceCommand(
  limiter: AttemptLimiter = createAttemptLimiter({ maxFailures: REPORTS_PER_WINDOW, windowMs: 10 * 60_000 }),
): SlashCommand {
  async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const reporterId = interaction.user.id;
    const voiceId = voiceIdOf(interaction.options.getString('voice', true));
    const voice = voiceId ? context.userVoices.publishedVoices().find((entry) => entry.id === voiceId) : undefined;
    if (!voice) {
      await replyEphemeral(interaction, 'Pick a community voice from the suggestions.');
      return;
    }
    if (limiter.waitMs(reporterId) > 0) {
      await replyEphemeral(interaction, "You've sent several reports already. Try again in a few minutes.");
      return;
    }
    limiter.fail(reporterId);
    const reason = interaction.options.getString('reason', true);
    await context.moderation.report({ at: new Date().toISOString(), voiceId: voice.id, reporterId, reason });
    await postToModLog(
      interaction,
      context,
      `🚩 **${voice.name}** by ${escapeMarkdown(voice.published?.authorUsername ?? voice.ownerId)} (\`${voice.id}\`) was reported by <@${reporterId}>: ${reason}`,
    );
    await replyEphemeral(interaction, "Thanks. Your report was sent to the bot's owners.");
  }

  async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
    const entries = matchCommunity(communityEntries(context, interaction.user.id), interaction.options.getFocused()).slice(0, AUTOCOMPLETE_LIMIT);
    await interaction.respond(entries.map((entry) => ({ name: entryLabel(entry).slice(0, 100), value: entryValue(entry) })));
  }

  return {
    data: new SlashCommandBuilder()
      .setName('reportvoice')
      .setDescription('Report a community voice to the bot\'s owners')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) => option.setName('voice').setDescription('The community voice').setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName('reason').setDescription('What is wrong with it').setRequired(true).setMaxLength(300))
      .toJSON(),
    execute,
    autocomplete,
  };
}
