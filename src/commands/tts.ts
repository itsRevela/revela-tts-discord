import {
  InteractionContextType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import { buildMentionResolver } from '../discord/mentionResolver.ts';
import { scheduleReplyDeletion } from '../discord/replyCleanup.ts';
import type { GuildSpeaker, GuildSpeakers } from '../playback/guildSpeakers.ts';
import { sanitizeForSpeech } from '../text/sanitize.ts';
import { speakableName } from '../text/speakableName.ts';
import { resolveVoice } from '../tts/voices.ts';
import { replyEphemeral, voiceChannelProblem } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

const QUEUE_FULL = 'The speech queue is full. Give it a moment to catch up.';

type Preflight = { readonly problem: string } | { readonly channel: VoiceBasedChannel };

function busyElsewhere(channelId: string): string {
  return `I'm already talking in <#${channelId}>. Join that channel, or use /leave there first.`;
}

/** Checks everything that can be answered instantly, before any slow work. */
function preflight(member: GuildMember, guild: Guild, speakers: GuildSpeakers): Preflight {
  const channel = member.voice.channel;
  if (!channel) return { problem: 'Join a voice channel first, then use /tts.' };
  const existing = speakers.get(guild.id);
  if (existing && existing.channelId !== channel.id) return { problem: busyElsewhere(existing.channelId) };
  if (existing?.isFull) return { problem: QUEUE_FULL };
  const problem = existing ? undefined : voiceChannelProblem(channel, guild.members.me);
  return problem ? { problem } : { channel };
}

/** Joins (if needed) and queues the speech. Returns the text for the public reply. */
async function speakInChannel(
  interaction: ChatInputCommandInteraction<'cached'>,
  channel: VoiceBasedChannel,
  message: { readonly raw: string; readonly spoken: string },
  context: CommandContext,
): Promise<string> {
  let speaker: GuildSpeaker;
  try {
    speaker = await context.speakers.connect(channel);
  } catch (error: unknown) {
    context.logger.error('Failed to join voice channel', { error, guildId: channel.guild.id, channelId: channel.id });
    return "I couldn't join the voice channel. Try again in a moment.";
  }
  if (speaker.channelId !== channel.id) return busyElsewhere(speaker.channelId);

  const { user, member } = interaction;
  const preferences = context.preferences.get(user.id);
  const result = speaker.speak({
    authorId: user.id,
    authorName: speakableName(member.displayName) ?? speakableName(user.username),
    announceName: preferences.announceName,
    text: message.spoken,
    sid: resolveVoice(preferences.voice).sid,
  });
  return result === 'full' ? QUEUE_FULL : `🔊 ${message.raw}`;
}

/** Posts the public reply (pinging no one) and schedules its deletion. */
async function publishReply(
  interaction: ChatInputCommandInteraction<'cached'>,
  content: string,
  context: CommandContext,
): Promise<void> {
  const reply = await interaction.editReply({ content, allowedMentions: { parse: [] } });
  scheduleReplyDeletion(
    { deleteViaInteraction: () => interaction.deleteReply(), deleteViaChannel: () => reply.delete() },
    context.config.replyDeleteMs,
    context.logger,
  );
}

async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, 'Use /tts in a server.');
    return;
  }
  const check = preflight(interaction.member, interaction.guild, context.speakers);
  if ('problem' in check) {
    await replyEphemeral(interaction, check.problem);
    return;
  }
  const raw = interaction.options.getString('text', true);
  const spoken = sanitizeForSpeech(raw, await buildMentionResolver(interaction.guild, raw));
  if (!spoken) {
    await replyEphemeral(interaction, "There's nothing in that message I can read aloud.");
    return;
  }
  await interaction.deferReply();
  const content = await speakInChannel(interaction, check.channel, { raw, spoken }, context);
  await publishReply(interaction, content, context);
}

export function createTtsCommand(maxTextLength: number): SlashCommand {
  const data = new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Read a message aloud in your voice channel')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('text').setDescription('What to say').setRequired(true).setMaxLength(maxTextLength),
    )
    .toJSON();
  return { data, execute };
}
