import {
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import { entryLabel, entryValue, findEntry, searchEntries, voiceEntries } from '../tts/voiceDirectory.ts';
import { LOCKED } from './customVoice.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';
import { allowedEntries, chooseVoice } from './voiceChoice.ts';

/** Everything except community voices, which have /communityvoices. */
const searchable = (context: CommandContext, userId: string) => allowedEntries(context, userId, { includeCommunity: false });

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  const requested = interaction.options.getString('query', true);
  const entry = findEntry(searchable(context, userId), requested);
  if (!entry) {
    const curated = findEntry(voiceEntries(context.catalog, { includeCommunity: false }), requested)?.voice.custom === true;
    await replyEphemeral(
      interaction,
      curated ? LOCKED : "That isn't one of the voices. Pick a suggestion while typing, browse with /voice, or find shared voices with /communityvoices.",
    );
    return;
  }
  await chooseVoice(context, userId, entry);
  await replyEphemeral(interaction, `Your /tts messages will now use ${entryLabel(entry)}.`);
}

async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  const entries = searchEntries(searchable(context, interaction.user.id), interaction.options.getFocused(), AUTOCOMPLETE_LIMIT);
  await interaction.respond(entries.map((entry) => ({ name: entryLabel(entry).slice(0, 100), value: entryValue(entry) })));
}

export const searchCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Find a voice by name, accent, grade or model and switch to it (not community voices)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('query').setDescription('Type to search, e.g. "heart", "pocket", "chinese" or a custom voice').setRequired(true).setAutocomplete(true),
    )
    .toJSON(),
  execute,
  autocomplete,
};
