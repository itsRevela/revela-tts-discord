import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import { AUTOCOMPLETE_LIMIT } from '../../tts/modelCatalog.ts';
import { NAME_MAX_LENGTH } from '../../userVoices/names.ts';
import { replyEphemeral } from '../shared.ts';
import type { CommandContext, SlashCommand } from '../types.ts';
import { askToDelete, askToPublish, handleButton, listVoices, renameVoice, unpublishVoice } from './manage.ts';
import { ADD_MODAL_ID, addVoiceModal, readAddModal, runUpload } from './upload.ts';

async function add(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!context.config.userVoices.uploadsEnabled) {
    await replyEphemeral(interaction, 'Voice uploads are switched off right now.');
    return;
  }
  const name = interaction.options.getString('name');
  const clip = interaction.options.getAttachment('clip');
  if (clip) {
    // A clip attached directly is used as is; without a name, the file name stands in.
    await runUpload(interaction, context, name ?? clip.name.replace(/.[^.]+$/, ''), clip);
    return;
  }
  // Without a clip, the form asks for it (and shows the tips).
  await interaction.showModal(addVoiceModal(context.config.userVoices.maxBytes, name));
}

const SUBCOMMANDS: Readonly<Record<string, (interaction: ChatInputCommandInteraction, context: CommandContext) => Promise<void>>> = {
  add,
  list: listVoices,
  rename: renameVoice,
  delete: askToDelete,
  publish: askToPublish,
  unpublish: unpublishVoice,
};

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const handler = SUBCOMMANDS[interaction.options.getSubcommand(true)];
  if (handler) await handler(interaction, context);
}

/** Suggests the user's own voices for the "voice" option. */
async function autocomplete(interaction: AutocompleteInteraction, context: CommandContext): Promise<void> {
  const needle = interaction.options.getFocused().trim().toLowerCase();
  const choices = context.userVoices
    .voicesOf(interaction.user.id)
    .filter((voice) => !needle || voice.name.toLowerCase().includes(needle))
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((voice) => ({ name: `${voice.name}${voice.published ? ' (published)' : ''}`, value: voice.id }));
  await interaction.respond(choices);
}

async function modal(interaction: ModalSubmitInteraction, context: CommandContext): Promise<void> {
  if (interaction.customId !== ADD_MODAL_ID) return;
  const { name, clip } = readAddModal(interaction);
  if (!clip) {
    await interaction.reply({ content: 'Attach a clip to add a voice.', flags: MessageFlags.Ephemeral });
    return;
  }
  await runUpload(interaction, context, name, clip);
}

async function component(interaction: MessageComponentInteraction, context: CommandContext): Promise<void> {
  await handleButton(interaction, context);
}

const voiceOption = (description: string) => (option: SlashCommandStringOption): SlashCommandStringOption =>
  option.setName('voice').setDescription(description).setRequired(true).setAutocomplete(true);

export const myVoicesCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('myvoices')
    .setDescription('Upload your own voices for Pocket TTS, and share them with the community')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Upload a clip to clone a new voice (opens a form with tips)')
        .addStringOption((option) => option.setName('name').setDescription('Name for the voice').setMaxLength(NAME_MAX_LENGTH))
        .addAttachmentOption((option) => option.setName('clip').setDescription('Attach the clip here instead of in the form')),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show your voices'))
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename one of your voices (its published copy too)')
        .addStringOption(voiceOption('The voice to rename'))
        .addStringOption((option) => option.setName('name').setDescription('The new name').setRequired(true).setMaxLength(NAME_MAX_LENGTH)),
    )
    .addSubcommand((sub) => sub.setName('delete').setDescription('Delete one of your voices everywhere').addStringOption(voiceOption('The voice to delete')))
    .addSubcommand((sub) => sub.setName('publish').setDescription('Share one of your voices in Community Voices').addStringOption(voiceOption('The voice to publish')))
    .addSubcommand((sub) => sub.setName('unpublish').setDescription('Take one of your voices out of Community Voices').addStringOption(voiceOption('The voice to unpublish')))
    .toJSON(),
  execute,
  autocomplete,
  component,
  modal,
};
