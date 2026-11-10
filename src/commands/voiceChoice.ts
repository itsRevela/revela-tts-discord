import { MessageFlags, type InteractionReplyOptions } from 'discord.js';
import { voiceEntries, type VoiceEntry, type VoiceListOptions } from '../tts/voiceDirectory.ts';
import type { CommandContext } from './types.ts';
import { initialPickerState, renderVoicePicker, type PickerState } from './voicePicker.ts';

/** "model:voice" for the user's current voice, as voice lists store it. */
export function currentValue(context: CommandContext, userId: string): string {
  const { model, voice } = context.preferences.get(userId);
  return `${model}:${voice}`;
}

/** What this user's lists include: curated custom voices once unlocked, their own uploads, and community voices. */
export function listOptions(context: CommandContext, userId: string, extra: Partial<VoiceListOptions> = {}): VoiceListOptions {
  return { includeCustom: context.preferences.get(userId).customVoices, userId, ...extra };
}

/** The voices this user may pick, with optional narrowing (e.g. no community voices). */
export function allowedEntries(context: CommandContext, userId: string, extra: Partial<VoiceListOptions> = {}): readonly VoiceEntry[] {
  return voiceEntries(context.catalog, listOptions(context, userId, extra));
}

/** Saves the voice and switches to its model. */
export async function chooseVoice(context: CommandContext, userId: string, entry: VoiceEntry): Promise<void> {
  await context.preferences.update(userId, { model: entry.model.id, voices: { [entry.model.id]: entry.voice.id } });
}

/** The private /voice picker, opened at the user's current voice or at a given filter. */
export function pickerReply(context: CommandContext, userId: string, groupId?: string): InteractionReplyOptions & { flags: MessageFlags.Ephemeral } {
  const current = currentValue(context, userId);
  const options = listOptions(context, userId);
  const state: PickerState = groupId ? { groupId, page: 0 } : initialPickerState(context.catalog, current, options);
  return { ...renderVoicePicker(context.catalog, state, current, undefined, options), flags: MessageFlags.Ephemeral };
}
