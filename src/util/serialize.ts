/**
 * Wraps an async function so calls run one at a time, in call order.
 * A rejected call does not block later calls.
 */
export function serialize<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: Args): Promise<Result> => {
    const run = tail.then(() => fn(...args));
    tail = run.catch(() => undefined);
    return run;
  };
}
