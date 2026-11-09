import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serialize } from '../../src/util/serialize.ts';

describe('serialize', () => {
  it('runs calls one at a time in call order', async () => {
    const events: string[] = [];
    const run = serialize(async (name: string, ms: number) => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      return name;
    });
    const results = await Promise.all([run('a', 20), run('b', 1)]);
    assert.deepEqual(results, ['a', 'b']);
    assert.deepEqual(events, ['start a', 'end a', 'start b', 'end b']);
  });

  it('keeps going after a failed call', async () => {
    const run = serialize(async (fail: boolean) => {
      if (fail) throw new Error('boom');
      return 'ok';
    });
    const first = run(true);
    const second = run(false);
    await assert.rejects(first, /boom/);
    assert.equal(await second, 'ok');
  });
});
