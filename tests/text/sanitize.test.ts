import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeForSpeech, type MentionResolver } from '../../src/text/sanitize.ts';

const resolver: MentionResolver = {
  user: (id) => (id === '111111111111111111' ? 'Sam' : undefined),
  role: (id) => (id === '222222222222222222' ? 'Raiders' : undefined),
  channel: (id) => (id === '333333333333333333' ? 'general' : undefined),
};

describe('sanitizeForSpeech', () => {
  it('leaves plain text alone', () => {
    assert.equal(sanitizeForSpeech('Is anyone up for a match?'), 'Is anyone up for a match?');
  });

  it('reads mentions as names, with fallbacks for unknown ids', () => {
    const text = 'hey <@111111111111111111> and <@!999999999999999999>, ping <@&222222222222222222> in <#333333333333333333>';
    assert.equal(sanitizeForSpeech(text, resolver), 'hey Sam and someone, ping Raiders in general');
  });

  it('summarizes links, code blocks, spoilers and timestamps', () => {
    assert.equal(sanitizeForSpeech('look https://example.com/a?b=c now'), 'look a link now');
    assert.equal(sanitizeForSpeech('run ```npm test``` please'), 'run code block please');
    assert.equal(sanitizeForSpeech('the ending is ||everyone dies||'), 'the ending is spoiler');
    assert.equal(sanitizeForSpeech('meet at <t:1700000000:R>'), 'meet at a timestamp');
  });

  it('reads custom emoji by name and drops unicode emoji', () => {
    assert.equal(sanitizeForSpeech('nice <:pog_champ:123456789012345678> 🎉🔥'), 'nice pog champ');
    assert.equal(sanitizeForSpeech('wave 👋🏽 bye'), 'wave bye');
  });

  it('strips markdown formatting', () => {
    assert.equal(sanitizeForSpeech('**bold** _it_ ~~old~~ `code`'), 'bold it old code');
    assert.equal(sanitizeForSpeech('# Title\n> quoted'), 'Title. quoted');
  });

  it('caps long runs of one character', () => {
    assert.equal(sanitizeForSpeech('noooooooo!!!!!!'), 'nooo!!!');
  });

  it('turns separate lines into sentences', () => {
    assert.equal(sanitizeForSpeech('first line\nsecond line!\nthird'), 'first line. second line! third');
  });

  it('folds decorative unicode letters', () => {
    assert.equal(sanitizeForSpeech('𝓱𝓮𝓵𝓵𝓸'), 'hello');
  });

  it('returns an empty string when nothing is speakable', () => {
    assert.equal(sanitizeForSpeech('🎉🎉 ***'), '');
    assert.equal(sanitizeForSpeech('   '), '');
  });
});
