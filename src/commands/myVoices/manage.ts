import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  escapeMarkdown,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import type { UserVoice } from '../../userVoices/catalog.ts';
import { UPLOADED_VOICE_MODEL } from '../../userVoices/catalogVoices.ts';
import { userVoiceKey } from '../../userVoices/ids.ts';
import { replyEphemeral } from '../shared.ts';
import type { CommandContext } from '../types.ts';

export const CONSENT_RULE =
  'Only publish your own voice, or one you have explicit permission to share. No public figures or other people without their consent.';

const describe = (voice: UserVoice): string => {
  const seconds = `${Math.round(voice.source.durationSec)} s`;
  const shared = voice.published ? `in Community Voices as **${voice.name} by ${escapeMarkdown(voice.published.authorUsername)}**` : 'private';
  return `• **${voice.name}** · ${seconds} · ${shared}`;
};

function confirmRow(action: 'delete' | 'publish', voice: UserVoice): ActionRowBuilder<ButtonBuilder> {
  const confirm = new ButtonBuilder()
    .setCustomId(`myvoices:${action}:${voice.id}`)
    .setLabel(action === 'delete' ? `Delete ${voice.name}` : `Publish ${voice.name}`)
    .setStyle(action === 'delete' ? ButtonStyle.Danger : ButtonStyle.Success);
  const cancel = new ButtonBuilder().setCustomId('myvoices:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);
}

export async function listVoices(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const voices = context.userVoices.voicesOf(interaction.user.id);
  const limit = context.config.userVoices.maxPerUser;
  await replyEphemeral(
    interaction,
    voices.length === 0
      ? 'You have no voices yet. Add one with `/myvoices add`.'
      : [`**Your voices (${voices.length}/${limit})**`, ...voices.map(describe)].join('\n'),
  );
}

export async function renameVoice(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const { user } = interaction;
  const result = await context.userVoices.rename(user.id, interaction.options.getString('voice', true), interaction.options.getString('name', true), user.username);
  await replyEphemeral(interaction, result.ok ? `Renamed to **${result.value.name}**${result.value.published ? ', in Community Voices too' : ''}.` : `❌ ${result.problem}`);
}

export async function askToDelete(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const voice = context.userVoices.findOwned(interaction.user.id, interaction.options.getString('voice', true));
  if (!voice) {
    await replyEphemeral(interaction, "You don't have a voice by that name. See `/myvoices list`.");
    return;
  }
  const published = voice.published ? ' It is also removed from Community Voices, and anyone using it switches back to Pocket\'s default voice.' : '';
  await interaction.reply({
    content: `Delete **${voice.name}**?${published} This can't be undone.`,
    components: [confirmRow('delete', voice)],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export async function askToPublish(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const { user } = interaction;
  const voice = context.userVoices.findOwned(user.id, interaction.options.getString('voice', true));
  if (!voice) {
    await replyEphemeral(interaction, "You don't have a voice by that name. See `/myvoices list`.");
    return;
  }
  if (voice.published) {
    await replyEphemeral(interaction, `**${voice.name}** is already in Community Voices.`);
    return;
  }
  await interaction.reply({
    content: `Publish **${voice.name}** to Community Voices as **${voice.name} by ${escapeMarkdown(user.username)}**?\n${CONSENT_RULE}`,
    components: [confirmRow('publish', voice)],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

export async function unpublishVoice(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  const result = await context.userVoices.unpublish(interaction.user.id, interaction.options.getString('voice', true));
  await replyEphemeral(
    interaction,
    result.ok ? `**${result.value.name}** is no longer in Community Voices. You can still use it yourself.` : `❌ ${result.problem}`,
  );
}

/** The buttons on /myvoices replies: use, confirm delete, confirm publish, cancel. */
export async function handleButton(interaction: MessageComponentInteraction, context: CommandContext): Promise<void> {
  const [, action, id = ''] = interaction.customId.split(':');
  const { user } = interaction;
  const done = (content: string) => interaction.update({ content, components: [], allowedMentions: { parse: [] } });
  if (action === 'cancel') {
    await done('Cancelled.');
    return;
  }
  if (action === 'use') {
    const voice = context.userVoices.findOwned(user.id, id);
    if (!voice) {
      await interaction.reply({ content: 'That voice no longer exists.', flags: MessageFlags.Ephemeral });
      return;
    }
    await context.preferences.update(user.id, { model: UPLOADED_VOICE_MODEL, voices: { [UPLOADED_VOICE_MODEL]: userVoiceKey(voice.id) } });
    await interaction.reply({ content: `Your /tts messages will now use **${voice.name}**.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (action === 'delete') {
    const result = await context.userVoices.remove(user.id, id);
    await done(result.ok ? `Deleted **${result.value.name}**.` : `❌ ${result.problem}`);
    return;
  }
  if (action === 'publish') {
    const result = await context.userVoices.publish(user.id, id, user.username);
    await done(
      result.ok
        ? `**${result.value.name}** is now in Community Voices as **${result.value.name} by ${escapeMarkdown(user.username)}**. Anyone can find it with /communityvoices.`
        : `❌ ${result.problem}`,
    );
  }
}
