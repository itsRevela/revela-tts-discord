import {
  InteractionContextType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { findVoice, resolveVoice, searchVoices, voiceLabel } from '../tts/voices.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const userId = interaction.user.id;
  const requested = interaction.options.getString('name');
  if (requested === null) {
    const current = resolveVoice(context.preferences.get(userId).voice);
    await replyEphemeral(interaction, `Your voice is ${voiceLabel(current)}. Pick another with \`/voice name\`.`);
    return;
  }
  const voice = findVoice(requested);
  if (!voice) {
    await replyEphemeral(interaction, 'That isn\'t one of the available voices. Start typing in the `name` option to see the list.');
    return;
  }
  await context.preferences.update(userId, { voice: voice.id });
  await replyEphemeral(interaction, `Your /tts messages will now use ${voiceLabel(voice)}.`);
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const choices = searchVoices(interaction.options.getFocused()).map((voice) => ({
    name: voiceLabel(voice),
    value: voice.id,
  }));
  await interaction.respond(choices);
}

export const voiceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Choose the voice for your /tts messages')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('name').setDescription('Voice to use; leave empty to see your current one').setAutocomplete(true),
    )
    .toJSON(),
  execute,
  autocomplete,
};
