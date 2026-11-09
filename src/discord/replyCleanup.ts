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

/** The message was already deleted (by someone else, or by an earlier cleanup). */
export function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMessage;
}

/** Deletions still in flight, so shutdown can wait for them. */
let inFlight: ReadonlySet<Promise<void>> = new Set();

function removeReply(reply: DeletableReply, viaInteraction: boolean, logger: Logger): void {
  const remove = viaInteraction ? reply.deleteViaInteraction : reply.deleteViaChannel;
  const deletion = remove().then(
    () => undefined,
    (error: unknown) => {
      if (isUnknownMessage(error)) return;
      logger.warn('Could not delete a /tts reply', { error });
    },
  );
  inFlight = new Set([...inFlight, deletion]);
  void deletion.finally(() => {
    inFlight = new Set([...inFlight].filter((pending) => pending !== deletion));
  });
}

/**
 * Waits up to `timeoutMs` for reply deletions already started, such as those
 * triggered by leaving every voice channel during shutdown.
 */
export async function settleReplyDeletions(timeoutMs: number): Promise<void> {
  if (inFlight.size === 0) return;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.allSettled([...inFlight]), timeout]);
  clearTimeout(timer);
}

export interface ReplyCleanup {
  /** The reply is visible in the channel. */
  posted(reply: DeletableReply): void;
  /** Its message finished playing, was skipped, or was dropped. */
  done(): void;
}

/**
 * Deletes a reply once it has been posted and its message is done, in either
 * order (a short message can finish before the reply is posted), and only once.
 */
export function createReplyCleanup(
  logger: Logger,
  now: () => number = Date.now,
  interactionWindowMs: number = INTERACTION_DELETE_WINDOW_MS,
): ReplyCleanup {
  let reply: DeletableReply | undefined;
  let postedAt = 0;
  let isDone = false;
  let deleted = false;
  const attempt = (): void => {
    if (deleted || !reply || !isDone) return;
    deleted = true;
    removeReply(reply, now() - postedAt <= interactionWindowMs, logger);
  };
  return {
    posted: (posted) => {
      reply = posted;
      postedAt = now();
      attempt();
    },
    done: () => {
      isDone = true;
      attempt();
    },
  };
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
  const timer = setTimeout(() => removeReply(reply, delayMs <= interactionWindowMs, logger), delayMs);
  timer.unref();
}
