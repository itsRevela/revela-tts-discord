import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type MessageComponentInteraction } from 'discord.js';
import { entryLabel, findEntry } from '../tts/voiceDirectory.ts';
import type { CommandContext, SlashCommand } from './types.ts';
import { allowedEntries, chooseVoice, currentValue, listOptions, pickerReply } from './voiceChoice.ts';
import { parsePickerCustomId, renderVoicePicker, type PickerState } from './voicePicker.ts';

/** /voice opens the private picker; typed searches moved to /search and /communityvoices. */
async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  await interaction.reply(pickerReply(context, interaction.user.id));
}

function nextState(action: string, state: PickerState, selected: string | undefined): PickerState {
  if (action === 'filter') return { groupId: selected ?? state.groupId, page: 0 };
  if (action === 'prev') return { ...state, page: state.page - 1 };
  if (action === 'next') return { ...state, page: state.page + 1 };
  return state;
}

/** Handles the picker's filter menu, voice menu and page buttons (also for pickers opened by /communityvoices). */
async function component(interaction: MessageComponentInteraction, context: CommandContext): Promise<void> {
  const parsed = parsePickerCustomId(interaction.customId);
  if (!parsed) return;
  const userId = interaction.user.id;
  const selected = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
  let notice: string | undefined;
  if (parsed.action === 'pick' && selected) {
    const entry = findEntry(allowedEntries(context, userId), selected);
    if (entry) {
      await chooseVoice(context, userId, entry);
      notice = `✅ Your /tts messages will now use ${entryLabel(entry)}.`;
    } else {
      notice = 'That voice is no longer available.';
    }
  }
  const state = nextState(parsed.action, parsed.state, selected);
  await interaction.update(renderVoicePicker(context.catalog, state, currentValue(context, userId), notice, listOptions(context, userId)));
}

export const voiceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Browse every voice by category and pick one (search with /search)')
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  execute,
  component,
};
