import {
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import { CUSTOM_VOICES, entriesInGroup, entryLabel, entryValue, voiceEntries, type VoiceEntry } from '../tts/voiceDirectory.ts';
import { currentVoiceSummary } from './describeVoice.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

function customEntries(context: CommandContext): readonly VoiceEntry[] {
  return entriesInGroup(voiceEntries(context.catalog), CUSTOM_VOICES.id);
}

function availableNames(entries: readonly VoiceEntry[]): string {
  const names = [...new Set(entries.map((entry) => entry.voice.label))];
  return names.length > 0 ? `Custom voices: ${names.join(', ')}.` : 'There are no custom voices yet.';
}

/**
 * "neutts:custom:rekp" picks that exact version; a bare "custom:rekp" or "rekp"
 * picks the version for the user's current model if it has one, else the first.
 */
export function findCustomEntry(entries: readonly VoiceEntry[], requested: string, currentModel: string): VoiceEntry | undefined {
  const exact = entries.find((entry) => entryValue(entry) === requested);
  if (exact) return exact;
  const needle = requested.toLowerCase();
  const matches = entries.filter((entry) => entry.voice.id === needle || entry.voice.label.toLowerCase() === needle);
  return matches.find((entry) => entry.model.id === currentModel) ?? matches[0];
}

export const LOCKED = 'Custom voices are locked. Use /unlock with the password to use them.';

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  if (!context.preferences.get(userId).customVoices) {
    await replyEphemeral(interaction, LOCKED);
    return;
  }
  const entries = customEntries(context);
  const requested = interaction.options.getString('name');
  if (requested === null) {
    await replyEphemeral(interaction, `${currentVoiceSummary(context, userId)} ${availableNames(entries)}`);
    return;
  }
  const match = findCustomEntry(entries, requested, context.preferences.get(userId).model);
  if (!match) {
    await replyEphemeral(interaction, `That isn't a custom voice. ${availableNames(entries)}`);
    return;
  }
  // Cloned voices belong to the model that clones them, so picking one switches to it.
  await context.preferences.update(userId, { model: match.model.id, voices: { [match.model.id]: match.voice.id } });
  await replyEphemeral(interaction, `Your /tts messages will now use the custom voice ${match.voice.label} (${match.model.name}).`);
}

async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  if (!context.preferences.get(interaction.user.id).customVoices) {
    await interaction.respond([]);
    return;
  }
  const needle = interaction.options.getFocused().trim().toLowerCase();
  const choices = customEntries(context)
    .filter((entry) => !needle || entryLabel(entry).toLowerCase().includes(needle))
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((entry) => ({ name: entryLabel(entry).slice(0, 100), value: entryValue(entry) }));
  await interaction.respond(choices);
}

export const customVoiceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('customvoice')
    .setDescription('Use a voice cloned from a recording for your /tts messages')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('name').setDescription('Custom voice; leave empty to list them').setAutocomplete(true),
    )
    .toJSON(),
  execute,
  autocomplete,
};
