import { InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { createAttemptLimiter, type AttemptLimiter } from '../unlock/attemptLimiter.ts';
import { passwordMatches } from '../unlock/password.ts';
import { replyEphemeral } from './shared.ts';
import type { CommandContext, SlashCommand } from './types.ts';

const MAX_PASSWORD_LENGTH = 100;

export const UNLOCKED =
  'Custom voices unlocked. Find them under "Custom voices" in /voice, or pick one with /customvoice.';

const minutes = (ms: number): string => {
  const count = Math.max(Math.ceil(ms / 60_000), 1);
  return `${count} minute${count === 1 ? '' : 's'}`;
};

/**
 * /unlock checks the custom-voice password privately. Wrong guesses are
 * limited per user, and neither the password nor the guess is ever logged.
 */
export function createUnlockCommand(limiter: AttemptLimiter = createAttemptLimiter()): SlashCommand {
  async function execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void> {
    const userId = interaction.user.id;
    const password = context.config.customVoicesPassword;
    if (password === undefined) {
      await replyEphemeral(interaction, 'Custom voices are open to everyone here, so there is nothing to unlock.');
      return;
    }
    if (context.preferences.get(userId).customVoices) {
      await replyEphemeral(interaction, 'Custom voices are already unlocked for you.');
      return;
    }
    const wait = limiter.waitMs(userId);
    if (wait > 0) {
      await replyEphemeral(interaction, `Too many wrong passwords. Try again in ${minutes(wait)}.`);
      return;
    }
    if (!passwordMatches(interaction.options.getString('password', true), password)) {
      const left = limiter.fail(userId);
      context.logger.info('Wrong custom-voice password', { userId, attemptsLeft: left });
      await replyEphemeral(interaction, left > 0 ? `That password is wrong. ${left} more ${left === 1 ? 'try' : 'tries'} before a short wait.` : 'That password is wrong. Try again later.');
      return;
    }
    limiter.reset(userId);
    await context.preferences.update(userId, { customVoicesUnlocked: true });
    context.logger.info('Custom voices unlocked', { userId });
    await replyEphemeral(interaction, UNLOCKED);
  }

  return {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Enter the password to use the custom voices')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option.setName('password').setDescription('Only you see this').setRequired(true).setMaxLength(MAX_PASSWORD_LENGTH),
      )
      .toJSON(),
    execute,
  };
}
