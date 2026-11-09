import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../tts/modelCatalog.ts';
import { entryLabel, entryValue, findEntry, searchEntries, voiceEntries, type VoiceEntry } from '../tts/voiceDirectory.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';
import { initialPickerState, parsePickerCustomId, renderVoicePicker, type PickerState } from './voicePicker.ts';

function currentValue(context: CommandContext, userId: string): string {
  const { model, voice } = context.preferences.get(userId);
  return `${model}:${voice}`;
}

/** Saves the voice and switches to its model. */
async function choose(context: CommandContext, userId: string, entry: VoiceEntry): Promise<void> {
  await context.preferences.update(userId, { model: entry.model.id, voices: { [entry.model.id]: entry.voice.id } });
}

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  const requested = interaction.options.getString('name');
  if (requested === null) {
    const current = currentValue(context, userId);
    const view = renderVoicePicker(context.catalog, initialPickerState(context.catalog, current), current);
    await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return;
  }
  const entry = findEntry(voiceEntries(context.catalog), requested);
  if (!entry) {
    await replyEphemeral(interaction, "That isn't one of the voices. Run `/voice` without a name to browse them all.");
    return;
  }
  await choose(context, userId, entry);
  await replyEphemeral(interaction, `Your /tts messages will now use ${entryLabel(entry)}.`);
}

async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  const entries = searchEntries(voiceEntries(context.catalog), interaction.options.getFocused(), AUTOCOMPLETE_LIMIT);
  await interaction.respond(entries.map((entry) => ({ name: entryLabel(entry).slice(0, 100), value: entryValue(entry) })));
}

function nextState(action: string, state: PickerState, selected: string | undefined): PickerState {
  if (action === 'filter') return { groupId: selected ?? state.groupId, page: 0 };
  if (action === 'prev') return { ...state, page: state.page - 1 };
  if (action === 'next') return { ...state, page: state.page + 1 };
  return state;
}

/** Handles the picker's filter menu, voice menu and page buttons. */
async function component(interaction: MessageComponentInteraction, context: CommandContext): Promise<void> {
  const parsed = parsePickerCustomId(interaction.customId);
  if (!parsed) return;
  const userId = interaction.user.id;
  const selected = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
  let notice: string | undefined;
  if (parsed.action === 'pick' && selected) {
    const entry = findEntry(voiceEntries(context.catalog), selected);
    if (entry) {
      await choose(context, userId, entry);
      notice = `✅ Your /tts messages will now use ${entryLabel(entry)}.`;
    } else {
      notice = 'That voice is no longer available.';
    }
  }
  const state = nextState(parsed.action, parsed.state, selected);
  await interaction.update(renderVoicePicker(context.catalog, state, currentValue(context, userId), notice));
}

export const voiceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Choose your /tts voice from every model; leave the name empty to browse them all')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Type to search, e.g. "heart", "pocket" or "chinese"; leave empty to open the picker')
        .setAutocomplete(true),
    )
    .toJSON(),
  execute,
  autocomplete,
  component,
};
