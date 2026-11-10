/** Wrong passwords allowed per window before a user has to wait. */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60_000;

export interface AttemptLimiterOptions {
  readonly maxFailures?: number;
  readonly windowMs?: number;
  /** Clock in milliseconds; injectable for tests. */
  readonly now?: () => number;
}

/** Limits guessing: after too many failures in a window, a user must wait for it to pass. */
export interface AttemptLimiter {
  /** Milliseconds until this user may try again; 0 when they may try now. */
  waitMs(userId: string): number;
  /** Records a wrong attempt; returns how many attempts are left in the window. */
  fail(userId: string): number;
  /** Forgets a user's failures after a success. */
  reset(userId: string): void;
}

interface Failures {
  readonly count: number;
  readonly since: number;
}

export function createAttemptLimiter(options: AttemptLimiterOptions = {}): AttemptLimiter {
  const maxFailures = options.maxFailures ?? MAX_FAILED_ATTEMPTS;
  const windowMs = options.windowMs ?? ATTEMPT_WINDOW_MS;
  const now = options.now ?? Date.now;
  let failures: ReadonlyMap<string, Failures> = new Map();

  const current = (userId: string): Failures | undefined => {
    const entry = failures.get(userId);
    return entry && now() - entry.since < windowMs ? entry : undefined;
  };

  return {
    waitMs: (userId) => {
      const entry = current(userId);
      return entry && entry.count >= maxFailures ? windowMs - (now() - entry.since) : 0;
    },
    fail: (userId) => {
      const entry = current(userId);
      const next = entry ? { ...entry, count: entry.count + 1 } : { count: 1, since: now() };
      // Expired entries are dropped whenever anything is recorded, so the map stays small.
      const live = [...failures].filter(([, value]) => now() - value.since < windowMs);
      failures = new Map([...live, [userId, next]]);
      return Math.max(maxFailures - next.count, 0);
    },
    reset: (userId) => {
      failures = new Map([...failures].filter(([id]) => id !== userId));
    },
  };
}
