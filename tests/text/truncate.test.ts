import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { truncateAtWord } from '../../src/text/truncate.ts';

describe('truncateAtWord', () => {
  it('leaves short text alone', () => {
    assert.equal(truncateAtWord('hello there', 20), 'hello there');
  });

  it('cuts at the last whole word within the limit', () => {
    assert.equal(truncateAtWord('the quick brown fox jumps', 17), 'the quick brown');
  });

  it('cuts mid-word when there is no space to cut at', () => {
    assert.equal(truncateAtWord('abcdefghijklmnop', 5), 'abcde');
  });
});
