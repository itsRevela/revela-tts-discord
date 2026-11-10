import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAttemptLimiter } from '../../src/unlock/attemptLimiter.ts';
import { passwordMatches } from '../../src/unlock/password.ts';

describe('passwordMatches', () => {
  it('accepts the exact password, ignoring surrounding spaces in what was typed', () => {
    assert.equal(passwordMatches('open sesame', 'open sesame'), true);
    assert.equal(passwordMatches('  open sesame ', 'open sesame'), true);
  });

  it('rejects anything else, including different case and length', () => {
    assert.equal(passwordMatches('Open sesame', 'open sesame'), false);
    assert.equal(passwordMatches('open', 'open sesame'), false);
    assert.equal(passwordMatches('', 'open sesame'), false);
  });
});

describe('createAttemptLimiter', () => {
  it('blocks a user after too many failures until the window passes', () => {
    let clock = 0;
    const limiter = createAttemptLimiter({ maxFailures: 3, windowMs: 1_000, now: () => clock });
    assert.equal(limiter.fail('alex'), 2);
    assert.equal(limiter.fail('alex'), 1);
    assert.equal(limiter.waitMs('alex'), 0);
    assert.equal(limiter.fail('alex'), 0);
    clock = 400;
    assert.equal(limiter.waitMs('alex'), 600);
    assert.equal(limiter.waitMs('bob'), 0, 'other users are unaffected');
    clock = 1_000;
    assert.equal(limiter.waitMs('alex'), 0);
  });

  it('forgets failures after a success', () => {
    const limiter = createAttemptLimiter({ maxFailures: 2, windowMs: 1_000, now: () => 0 });
    limiter.fail('alex');
    limiter.fail('alex');
    limiter.reset('alex');
    assert.equal(limiter.waitMs('alex'), 0);
  });
});
