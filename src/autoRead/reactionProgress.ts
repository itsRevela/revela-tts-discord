import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { LOADING_GRACE_MS } from '../loading/loadingReply.ts';
import type { Logger } from '../logging/logger.ts';
import type { SpeechStatus } from '../playback/speechStatus.ts';

/** Shown on an auto-read message while its speech is being generated. */
export const PROGRESS_REACTION = '⏳';

/** Expected when the channel forbids reactions or the message is gone: nothing to report. */
const QUIET_ERRORS: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.MissingPermissions,
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.UnknownMessage,
]);

export interface ReactionProgressOptions<Added> {
  /** Adds the reaction; the result is handed back to `remove`. */
  readonly add: () => Promise<Added>;
  readonly remove: (added: Added) => Promise<unknown>;
  readonly logger: Logger;
  readonly graceMs?: number;
}

export interface ReactionProgress {
  /** Latest status from the speech queue; "playing" removes the reaction. */
  update(status: SpeechStatus): void;
  /** Removes the reaction (if shown) and stops. */
  finish(): void;
}

/**
 * Marks an auto-read message with a reaction while its speech is generated, so
 * the sender can see the bot is working. Like the /tts progress line, it only
 * appears if playback has not started within the grace period, and it is
 * removed when playback starts or the message ends.
 */
export function createReactionProgress<Added>(options: ReactionProgressOptions<Added>): ReactionProgress {
  const { add, remove, logger } = options;
  let added: Promise<Added | undefined> | undefined;
  let stopped = false;

  const report = (action: string) => (error: unknown): undefined => {
    const quiet = error instanceof DiscordAPIError && typeof error.code === 'number' && QUIET_ERRORS.has(error.code);
    if (!quiet) logger.warn(`Could not ${action} the auto-read progress reaction`, { error });
    return undefined;
  };

  const timer = setTimeout(() => {
    if (!stopped) added = add().catch(report('add'));
  }, options.graceMs ?? LOADING_GRACE_MS);
  timer.unref();

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    void added?.then((reaction) => (reaction === undefined ? undefined : remove(reaction).catch(report('remove'))));
  };

  return {
    update: (status) => {
      if (status.stage === 'playing') finish();
    },
    finish,
  };
}
