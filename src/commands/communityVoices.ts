import {
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import { COMMUNITY_VOICES, entriesInGroup, entryLabel, entryValue, findEntry, type VoiceEntry } from '../tts/voiceDirectory.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';
import { allowedEntries, chooseVoice, pickerReply } from './voiceChoice.ts';

/** Published uploads, newest first. */
export function communityEntries(context: CommandContext, userId: string): readonly VoiceEntry[] {
  return entriesInGroup(allowedEntries(context, userId), COMMUNITY_VOICES.id);
}

/** Matches a typed query against the voice name and its author. */
export function matchCommunity(entries: readonly VoiceEntry[], query: string): readonly VoiceEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => !needle || entryLabel(entry).toLowerCase().includes(needle));
}

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  const query = interaction.options.getString('query');
  if (query === null) {
    await interaction.reply(pickerReply(context, userId, COMMUNITY_VOICES.id));
    return;
  }
  const entries = communityEntries(context, userId);
  const entry = findEntry(entries, query) ?? (matchCommunity(entries, query).length === 1 ? matchCommunity(entries, query)[0] : undefined);
  if (!entry) {
    await replyEphemeral(interaction, 'No community voice matches that. Pick a suggestion while typing, or run /communityvoices on its own to browse.');
    return;
  }
  await chooseVoice(context, userId, entry);
  await replyEphemeral(interaction, `Your /tts messages will now use ${entryLabel(entry)}.`);
}

async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  const entries = matchCommunity(communityEntries(context, interaction.user.id), interaction.options.getFocused()).slice(0, AUTOCOMPLETE_LIMIT);
  await interaction.respond(entries.map((entry) => ({ name: entryLabel(entry).slice(0, 100), value: entryValue(entry) })));
}

export const communityVoicesCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('communityvoices')
    .setDescription('Find a voice shared by the community and switch to it; leave empty to browse')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('query').setDescription('Type a voice name or its author').setAutocomplete(true),
    )
    .toJSON(),
  execute,
  autocomplete,
};
