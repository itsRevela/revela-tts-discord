import { isUnknownMessage } from '../discord/replyCleanup.ts';
import type { Logger } from '../logging/logger.ts';
import type { SpeechStatus } from '../playback/speechStatus.ts';
import { renderLoading, type WaitingStatus } from './renderLoading.ts';

/** Fast models start playing within this long, so they never show a progress line. */
export const LOADING_GRACE_MS = 1_500;
/** Reply edits at most this often, well inside Discord's rate limits. */
export const LOADING_REFRESH_MS = 2_000;

export interface LoadingReplyOptions<Posted> {
  /** The reply's text once playback has started. */
  readonly content: string;
  /** Replaces the reply's text; the first call posts it. */
  readonly edit: (content: string) => Promise<Posted>;
  /** Called once, with the result of the first successful edit. */
  readonly onPosted: (posted: Posted) => void;
  readonly logger: Logger;
  readonly graceMs?: number;
  readonly refreshMs?: number;
  /** Clock in milliseconds; injectable for tests. */
  readonly now?: () => number;
}

export interface LoadingReply {
  /** Latest status from the speech queue; "playing" finishes the display. */
  update(status: SpeechStatus): void;
  /** Shows the plain reply and stops updating (playback started, or the message ended). */
  finish(): void;
  /** Stops without editing, when the reply is used for something else. */
  cancel(): void;
}

const UNKNOWN: WaitingStatus = { stage: 'generating', ahead: 0, progress: undefined, secondsLeft: undefined };

interface Latest {
  readonly status: WaitingStatus;
  readonly at: number;
}

/**
 * Keeps a /tts reply showing generation progress until playback starts. The
 * reply is first posted after a short grace period (or when playback starts,
 * if sooner), then refreshed on a timer with the latest status. Edits run one
 * at a time, and unchanged text is never re-sent.
 */
export function createLoadingReply<Posted>(options: LoadingReplyOptions<Posted>): LoadingReply {
  const { content, edit, onPosted, logger } = options;
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? LOADING_REFRESH_MS;
  const startedAt = now();
  let latest: Latest | undefined;
  let shownProgress: number | undefined;
  let lastSent: string | undefined;
  let posted = false;
  let stopped = false;
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const send = (text: string): void => {
    chain = chain.then(async () => {
      if (text === lastSent) return;
      try {
        const result = await edit(text);
        lastSent = text;
        if (!posted) {
          posted = true;
          onPosted(result);
        }
      } catch (error: unknown) {
        if (!isUnknownMessage(error)) logger.warn('Could not update a /tts reply', { error });
      }
    });
  };

  const render = (): string => {
    const status = latest?.status ?? UNKNOWN;
    const sinceUpdate = latest ? (now() - latest.at) / 1000 : 0;
    const secondsLeft =
      status.stage === 'generating' && status.secondsLeft !== undefined
        ? Math.max(status.secondsLeft - sinceUpdate, 0)
        : undefined;
    return renderLoading(content, {
      status,
      progress: status.stage === 'generating' ? shownProgress : undefined,
      secondsLeft,
      elapsedSeconds: (now() - startedAt) / 1000,
    });
  };

  const tick = (): void => {
    if (stopped) return;
    send(render());
    void chain.then(() => {
      if (stopped) return;
      timer = setTimeout(tick, refreshMs);
      timer.unref();
    });
  };

  timer = setTimeout(tick, options.graceMs ?? LOADING_GRACE_MS);
  timer.unref();

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    send(content);
  };

  return {
    update: (status) => {
      if (stopped) return;
      if (status.stage === 'playing') {
        finish();
        return;
      }
      if (status.stage !== 'generating') shownProgress = undefined;
      else if (status.progress !== undefined) shownProgress = Math.max(shownProgress ?? 0, status.progress);
      latest = { status, at: now() };
    },
    finish,
    cancel: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
