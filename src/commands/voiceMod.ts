import {
  InteractionContextType,
  SlashCommandBuilder,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import type { UserVoice } from '../userVoices/catalog.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

/** Lines shown by /voicemod list; the rest is summarized. */
const LIST_LIMIT = 25;

const describe = (voice: UserVoice): string =>
  `• **${voice.name}** \`${voice.id}\` by <@${voice.ownerId}> · ${voice.published ? `published as ${escapeMarkdown(voice.published.authorUsername)}` : 'private'}`;

async function takedown(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const reason = interaction.options.getString('reason', true);
  const voice = context.userVoices.publishedVoices().find((entry) => entry.id === interaction.options.getString('voice', true));
  if (!voice) {
    await replyEphemeral(interaction, 'No community voice has that id. Pick one from the suggestions.');
    return;
  }
  const result = await context.userVoices.remove(interaction.user.id, voice.id, true);
  if (!result.ok) {
    await replyEphemeral(interaction, `❌ ${result.problem}`);
    return;
  }
  context.logger.info('Community voice taken down', { voiceId: voice.id, ownerId: voice.ownerId, by: interaction.user.id });
  await interaction.client.users
    .send(voice.ownerId, `Your community voice **${voice.name}** was removed by a moderator. Reason: ${reason}`)
    .catch(() => undefined);
  await replyEphemeral(interaction, `Removed **${voice.name}** by ${escapeMarkdown(voice.published?.authorUsername ?? voice.ownerId)}. Its author was told why, if their DMs are open.`);
}

async function ban(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const target = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') ?? undefined;
  await context.moderation.ban(target.id, { at: new Date().toISOString(), byUserId: interaction.user.id, ...(reason ? { reason } : {}) });
  const published = context.userVoices.voicesOf(target.id).filter((voice) => voice.published);
  for (const voice of published) await context.userVoices.unpublish(target.id, voice.id);
  context.logger.info('User banned from uploading voices', { userId: target.id, by: interaction.user.id, unpublished: published.length });
  await replyEphemeral(interaction, `<@${target.id}> can no longer upload or publish voices. ${published.length} of their voices left Community Voices.`);
}

async function unban(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const target = interaction.options.getUser('user', true);
  const lifted = await context.moderation.unban(target.id);
  await replyEphemeral(interaction, lifted ? `<@${target.id}> can upload and publish voices again.` : `<@${target.id}> wasn't banned.`);
}

async function list(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const target = interaction.options.getUser('user');
  const voices = target ? context.userVoices.voicesOf(target.id) : context.userVoices.allVoices();
  const reports = context.moderation.get().reports.length;
  const lines = voices.slice(0, LIST_LIMIT).map(describe);
  const more = voices.length > LIST_LIMIT ? [`…and ${voices.length - LIST_LIMIT} more.`] : [];
  const header = `**${voices.length} uploaded voice${voices.length === 1 ? '' : 's'}**${target ? ` by <@${target.id}>` : ''} · ${reports} report${reports === 1 ? '' : 's'} on file`;
  await replyEphemeral(interaction, [header, ...lines, ...more].join('\n'));
}

const SUBCOMMANDS: Readonly<Record<string, (interaction: ChatInputCommandInteraction, context: CommandContext) => Promise<void>>> = {
  takedown,
  ban,
  unban,
  list,
};

/** Only the owners listed in OWNER_USER_IDS may moderate; Discord also hides the command from non-admins. */
async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!context.config.ownerUserIds.includes(interaction.user.id)) {
    await replyEphemeral(interaction, "Only the bot's owners can moderate community voices.");
    return;
  }
  const handler = SUBCOMMANDS[interaction.options.getSubcommand(true)];
  if (handler) await handler(interaction, context);
}

async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  if (!context.config.ownerUserIds.includes(interaction.user.id)) {
    await interaction.respond([]);
    return;
  }
  const needle = interaction.options.getFocused().trim().toLowerCase();
  const choices = context.userVoices
    .publishedVoices()
    .filter((voice) => !needle || `${voice.name} ${voice.published?.authorUsername ?? ''}`.toLowerCase().includes(needle))
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((voice) => ({ name: `${voice.name} by ${voice.published?.authorUsername ?? 'unknown'}`.slice(0, 100), value: voice.id }));
  await interaction.respond(choices);
}

export const voiceModCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voicemod')
    .setDescription('Moderate community voices (bot owners only)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(0)
    .addSubcommand((sub) =>
      sub
        .setName('takedown')
        .setDescription('Delete a community voice and tell its author why')
        .addStringOption((option) => option.setName('voice').setDescription('The community voice').setRequired(true).setAutocomplete(true))
        .addStringOption((option) => option.setName('reason').setDescription('Sent to the author').setRequired(true).setMaxLength(300)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('ban')
        .setDescription('Stop someone uploading and publishing voices (unpublishes theirs)')
        .addUserOption((option) => option.setName('user').setDescription('Who to ban').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Kept with the ban').setMaxLength(300)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('unban')
        .setDescription('Allow someone to upload and publish again')
        .addUserOption((option) => option.setName('user').setDescription('Who to unban').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List uploaded voices, everyone\'s or one person\'s')
        .addUserOption((option) => option.setName('user').setDescription('Only this person\'s voices')),
    )
    .toJSON(),
  execute,
  autocomplete,
};
