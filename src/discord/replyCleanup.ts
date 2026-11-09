import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { Logger } from '../logging/logger.ts';

/**
 * Interaction tokens expire after 15 minutes. Deleting through the interaction
 * needs no channel permissions, so it is used whenever the deadline allows,
 * with a minute of margin; later deletions go through the channel instead.
 */
export const INTERACTION_DELETE_WINDOW_MS = 14 * 60_000;

/** Two ways to remove the same reply message. */
export interface DeletableReply {
  deleteViaInteraction(): Promise<unknown>;
  deleteViaChannel(): Promise<unknown>;
}

function alreadyGone(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage;
}

/**
 * Deletes a reply after `delayMs`; 0 keeps it. Pending deletions live in
 * memory, so replies posted shortly before a restart are kept.
 */
export function scheduleReplyDeletion(
  reply: DeletableReply,
  delayMs: number,
  logger: Logger,
  interactionWindowMs: number = INTERACTION_DELETE_WINDOW_MS,
): void {
  if (delayMs <= 0) return;
  const remove = delayMs <= interactionWindowMs ? reply.deleteViaInteraction : reply.deleteViaChannel;
  const timer = setTimeout(() => {
    remove().catch((error: unknown) => {
      if (alreadyGone(error)) return;
      logger.warn('Could not delete a /tts reply', { error });
    });
  }, delayMs);
  timer.unref();
}
