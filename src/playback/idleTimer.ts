export interface IdleTimer {
  /** Restarts the countdown. */
  touch(): void;
  cancel(): void;
}

/**
 * Calls `onIdle` once `timeoutMs` passes without a touch, unless `isBusy` says
 * work is still running, in which case it waits another full period.
 * A timeout of 0 disables it.
 */
export function createIdleTimer(timeoutMs: number, isBusy: () => boolean, onIdle: () => void): IdleTimer {
  let timer: NodeJS.Timeout | undefined;
  const touch = (): void => {
    if (timeoutMs <= 0) return;
    clearTimeout(timer);
    timer = setTimeout(() => (isBusy() ? touch() : onIdle()), timeoutMs);
    timer.unref();
  };
  return { touch, cancel: () => clearTimeout(timer) };
}
