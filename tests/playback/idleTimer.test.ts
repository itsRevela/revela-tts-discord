import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIdleTimer } from '../../src/playback/idleTimer.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createIdleTimer', () => {
  it('fires once the timeout passes without a touch', async () => {
    let fired = 0;
    const timer = createIdleTimer(15, () => false, () => { fired += 1; });
    timer.touch();
    await wait(40);
    assert.equal(fired, 1);
  });

  it('waits another period while work is still running', async () => {
    let fired = 0;
    let busy = true;
    const timer = createIdleTimer(15, () => busy, () => { fired += 1; });
    timer.touch();
    await wait(25);
    assert.equal(fired, 0);
    busy = false;
    await wait(30);
    assert.equal(fired, 1);
  });

  it('restarts on touch and stops on cancel', async () => {
    let fired = 0;
    const timer = createIdleTimer(30, () => false, () => { fired += 1; });
    timer.touch();
    await wait(20);
    timer.touch();
    await wait(20);
    assert.equal(fired, 0);
    timer.cancel();
    await wait(30);
    assert.equal(fired, 0);
  });

  it('is disabled by a zero timeout', async () => {
    let fired = 0;
    createIdleTimer(0, () => false, () => { fired += 1; }).touch();
    await wait(10);
    assert.equal(fired, 0);
  });
});
