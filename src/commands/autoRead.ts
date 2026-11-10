import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type SlashCommandChannelOption,
} from 'discord.js';
import { PROGRESS_REACTION } from '../autoRead/reactionProgress.ts';
import { MAX_AUTO_READ_CHANNELS } from '../preferences/userPreferences.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

/** Text channels, announcement channels and the chat built into voice channels. */
const READABLE_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice] as const;
const READABLE: ReadonlySet<ChannelType> = new Set(READABLE_TYPES);

const mentionAll = (channelIds: readonly string[]): string => channelIds.map((id) => `<#${id}>`).join(', ');

function listLine(channelIds: readonly string[]): string {
  return channelIds.length > 0
    ? `Auto-read is on in ${mentionAll(channelIds)}.`
    : 'Auto-read is off in this server. Use /autoread add to pick a channel.';
}

/** The channel named in the command, or the one it was used in. */
function targetChannel(interaction: ChatInputCommandInteraction<'cached'>): GuildBasedChannel | null {
  return interaction.options.getChannel('channel') ?? interaction.channel;
}

async function save(
  interaction: ChatInputCommandInteraction<'cached'>,
  channelIds: readonly string[],
  context: CommandContext,
): Promise<void> {
  await context.preferences.update(interaction.user.id, { autoRead: { [interaction.guildId]: channelIds } });
}

/** Problems that stop auto-read in `channel`, then a note about the progress reaction if it can't be shown. */
function channelCheck(interaction: ChatInputCommandInteraction<'cached'>, channel: GuildBasedChannel): { problem?: string; note: string } {
  if (!READABLE.has(channel.type)) return { problem: 'Pick a text channel, or the chat of a voice channel.', note: '' };
  const me = interaction.guild.members.me;
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
    return { problem: `I can't see <#${channel.id}>, so I can't read your messages there. Give me View Channel there, or pick another channel.`, note: '' };
  }
  const canReact = permissions.has(PermissionFlagsBits.AddReactions) && permissions.has(PermissionFlagsBits.ReadMessageHistory);
  const note = canReact
    ? ''
    : ` I can't show the ${PROGRESS_REACTION} progress reaction there without Add Reactions and Read Message History.`;
  return { note };
}

async function add(interaction: ChatInputCommandInteraction<'cached'>, context: CommandContext): Promise<void> {
  const channels = context.preferences.autoReadChannels(interaction.user.id, interaction.guildId);
  const channel = targetChannel(interaction);
  if (!channel) {
    await replyEphemeral(interaction, 'Pick a channel for auto-read.');
    return;
  }
  if (channels.includes(channel.id)) {
    await replyEphemeral(interaction, `Auto-read is already on in <#${channel.id}>. ${listLine(channels)}`);
    return;
  }
  if (channels.length >= MAX_AUTO_READ_CHANNELS) {
    await replyEphemeral(interaction, `You can use auto-read in at most ${MAX_AUTO_READ_CHANNELS} channels per server. Remove one with /autoread remove first.`);
    return;
  }
  const { problem, note } = channelCheck(interaction, channel);
  if (problem) {
    await replyEphemeral(interaction, problem);
    return;
  }
  const next = [...channels, channel.id];
  await save(interaction, next, context);
  await replyEphemeral(
    interaction,
    `Messages you send in <#${channel.id}> will be read aloud in your voice channel, like /tts. ${listLine(next)}${note}`,
  );
}

async function remove(interaction: ChatInputCommandInteraction<'cached'>, context: CommandContext): Promise<void> {
  const channels = context.preferences.autoReadChannels(interaction.user.id, interaction.guildId);
  const channel = targetChannel(interaction);
  if (!channel || !channels.includes(channel.id)) {
    const where = channel ? ` in <#${channel.id}>` : '';
    await replyEphemeral(interaction, `Auto-read isn't on${where}. ${listLine(channels)}`);
    return;
  }
  const next = channels.filter((id) => id !== channel.id);
  await save(interaction, next, context);
  await replyEphemeral(interaction, `Stopped reading your messages in <#${channel.id}>. ${listLine(next)}`);
}

async function off(interaction: ChatInputCommandInteraction<'cached'>, context: CommandContext): Promise<void> {
  await save(interaction, [], context);
  await replyEphemeral(interaction, 'Auto-read is off in every channel of this server. Use /tts to have messages read.');
}

async function list(interaction: ChatInputCommandInteraction<'cached'>, context: CommandContext): Promise<void> {
  await replyEphemeral(interaction, listLine(context.preferences.autoReadChannels(interaction.user.id, interaction.guildId)));
}

const SUBCOMMANDS: Readonly<Record<string, (interaction: ChatInputCommandInteraction<'cached'>, context: CommandContext) => Promise<void>>> = {
  add,
  remove,
  off,
  list,
};

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, 'Use /autoread in a server.');
    return;
  }
  const handler = SUBCOMMANDS[interaction.options.getSubcommand(true)];
  if (handler) await handler(interaction, context);
}

const channelOption =
  (description: string) =>
  (option: SlashCommandChannelOption): SlashCommandChannelOption =>
    option.setName('channel').setDescription(description).addChannelTypes(...READABLE_TYPES);

export const autoReadCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('autoread')
    .setDescription('Have your ordinary messages in chosen channels read aloud, without /tts')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Read your messages in a channel aloud')
        .addChannelOption(channelOption('Channel to read (default: this one)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop reading your messages in a channel')
        .addChannelOption(channelOption('Channel to stop reading (default: this one)')),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Show the channels where your messages are read'))
    .addSubcommand((sub) => sub.setName('off').setDescription('Stop reading your messages in every channel of this server'))
    .toJSON(),
  execute,
};
