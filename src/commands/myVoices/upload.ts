import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputStyle,
  type Attachment,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { progressBar } from '../../loading/renderLoading.ts';
import { SUPPORTED_FORMATS } from '../../userVoices/attachment.ts';
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from '../../userVoices/names.ts';
import type { UploadProgress } from '../../userVoices/service.ts';
import type { CommandContext } from '../types.ts';

export const ADD_MODAL_ID = 'myvoices:add';
const NAME_FIELD = 'name';
const CLIP_FIELD = 'clip';

export function uploadTips(maxBytes: number): string {
  const megabytes = Math.round(maxBytes / (1024 * 1024));
  return [
    '**Tips for the best result**',
    '• 10–20 seconds of one person talking normally (3–60 s accepted; the first 30 s are used)',
    '• No music, background noise or other voices',
    '• Start right on the speech, without silence',
    `• ${SUPPORTED_FORMATS}, up to ${megabytes} MB`,
    '• Only your own voice, or one you have permission to use',
  ].join('\n');
}

/** The pop-up form: tips, a name field (prefilled if given) and a file picker. */
export function addVoiceModal(maxBytes: number, prefilledName: string | null): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(ADD_MODAL_ID)
    .setTitle('Add a voice')
    .addTextDisplayComponents((text) => text.setContent(uploadTips(maxBytes)))
    .addLabelComponents(
      (label) =>
        label.setLabel('Voice name').setTextInputComponent((input) => {
          const field = input
            .setCustomId(NAME_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMinLength(NAME_MIN_LENGTH)
            .setMaxLength(NAME_MAX_LENGTH)
            .setRequired(true);
          return prefilledName ? field.setValue(prefilledName.slice(0, NAME_MAX_LENGTH)) : field;
        }),
      (label) =>
        label
          .setLabel('Voice clip')
          .setDescription('One recording of the voice')
          .setFileUploadComponent((upload) => upload.setCustomId(CLIP_FIELD).setMinValues(1).setMaxValues(1).setRequired(true)),
    );
}

/** The name and file from a submitted form. */
export function readAddModal(interaction: ModalSubmitInteraction): { name: string; clip: Attachment | undefined } {
  return {
    name: interaction.fields.getTextInputValue(NAME_FIELD),
    clip: interaction.fields.getUploadedFiles(CLIP_FIELD, false)?.first(),
  };
}

const STAGES: Readonly<Record<UploadProgress['stage'], { readonly text: string; readonly progress: number }>> = {
  waiting: { text: 'Waiting for other uploads to finish', progress: 0.05 },
  downloading: { text: 'Downloading your clip', progress: 0.2 },
  cloning: { text: 'Checking and cloning the voice', progress: 0.55 },
  preview: { text: 'Making a preview', progress: 0.85 },
};

export function progressContent(name: string, progress: UploadProgress): string {
  const stage = STAGES[progress.stage];
  const waiting = progress.stage === 'waiting' && progress.ahead
    ? ` (${progress.ahead} upload${progress.ahead === 1 ? '' : 's'} ahead of yours)`
    : '';
  return `**Adding ${name}**\n⏳ ${stage.text}${waiting} ${progressBar(stage.progress)} ${Math.round(stage.progress * 100)}%`;
}

export const useVoiceButton = (id: string): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`myvoices:use:${id}`).setLabel('Use it now').setStyle(ButtonStyle.Primary),
  );

/**
 * Runs an upload with a private progress line, then shows the result: the
 * preview and a "Use it now" button, or what went wrong.
 */
export async function runUpload(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  context: CommandContext,
  name: string,
  clip: Attachment,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let edits: Promise<unknown> = Promise.resolve();
  const show = (content: string): void => {
    edits = edits.then(() => interaction.editReply({ content, allowedMentions: { parse: [] } })).catch((error: unknown) => {
      context.logger.warn('Could not update the upload progress', { error });
    });
  };
  const result = await context.userVoices.add(
    { ownerId: interaction.user.id, name, clip: { name: clip.name, size: clip.size, contentType: clip.contentType, url: clip.url } },
    (progress) => show(progressContent(name.trim(), progress)),
  );
  await edits;
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.problem}`, components: [], allowedMentions: { parse: [] } });
    return;
  }
  const { voice, preview, truncated } = result.value;
  const lines = [
    `✅ **${voice.name}** is ready! It's in /voice under My Voices.${preview ? ' Here is a preview.' : ''}`,
    truncated ? 'Only the first 30 seconds of your clip were used.' : undefined,
    'Share it with everyone using `/myvoices publish`.',
  ];
  await interaction.editReply({
    content: lines.filter(Boolean).join('\n'),
    files: preview ? [{ attachment: preview, name: `${voice.id}-preview.wav` }] : [],
    components: [useVoiceButton(voice.id)],
    allowedMentions: { parse: [] },
  });
}
