import type { SpeechStatus } from '../playback/speechStatus.ts';

const BAR_SEGMENTS = 10;
/** Below this many seconds left, the estimate is too fine to be worth a number. */
const ALMOST_READY_SECONDS = 1.5;

export type WaitingStatus = Exclude<SpeechStatus, { readonly stage: 'playing' }>;

export interface LoadingView {
  readonly status: WaitingStatus;
  /** Progress to draw, 0 to 1, already kept from going backwards; undefined when unknown. */
  readonly progress: number | undefined;
  /** Estimated seconds until playback, counted down since the last update. */
  readonly secondsLeft: number | undefined;
  /** Seconds since the request, shown when there is no estimate so the reply visibly moves. */
  readonly elapsedSeconds: number;
}

const messages = (count: number): string => `${count} message${count === 1 ? '' : 's'}`;

export function progressBar(progress: number): string {
  const filled = Math.min(Math.max(Math.round(progress * BAR_SEGMENTS), 0), BAR_SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(BAR_SEGMENTS - filled);
}

function timeLeft(seconds: number): string {
  return seconds < ALMOST_READY_SECONDS ? 'almost ready' : `about ${Math.ceil(seconds)} s`;
}

function generatingLine(view: LoadingView, ahead: number): string {
  if (view.progress === undefined) return `⏳ Generating voice · ${Math.floor(view.elapsedSeconds)} s`;
  const percent = Math.min(Math.floor(view.progress * 100), 99);
  const base = `⏳ Generating voice ${progressBar(view.progress)} ${percent}%`;
  if (ahead > 0) return `${base} · plays after ${messages(ahead)}`;
  return view.secondsLeft === undefined ? base : `${base} · ${timeLeft(view.secondsLeft)}`;
}

/** The status line shown under a /tts reply until its playback starts. */
export function loadingLine(view: LoadingView): string {
  const { status } = view;
  switch (status.stage) {
    case 'queued':
      return `⏳ In line · ${messages(status.ahead)} ahead`;
    case 'ready':
      return `✅ Ready · plays after ${messages(status.ahead)}`;
    case 'generating':
      return generatingLine(view, status.ahead);
  }
}

/** The reply text with the status line underneath, in Discord's small grey subtext. */
export function renderLoading(content: string, view: LoadingView): string {
  return `${content}\n-# ${loadingLine(view)}`;
}
