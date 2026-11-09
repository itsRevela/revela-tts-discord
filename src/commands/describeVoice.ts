import type { CommandContext } from './types.ts';

/** "You're using Pocket TTS with the voice Alba (Kyutai's default)." */
export function currentVoiceSummary(context: CommandContext, userId: string): string {
  const { model, voice } = context.preferences.get(userId);
  const loaded = context.catalog.findModel(model);
  const voiceInfo = context.catalog.findVoice(model, voice);
  const voiceText = voiceInfo?.custom ? `the custom voice ${voiceInfo.label}` : `the voice ${voiceInfo?.label ?? voice}`;
  return `You're using ${loaded?.name ?? model} with ${voiceText}.`;
}
