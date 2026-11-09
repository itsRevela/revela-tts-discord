import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeUtterance, shouldAnnounce } from '../../src/text/utterance.ts';

describe('shouldAnnounce', () => {
  it('announces a new speaker who has the setting on', () => {
    assert.equal(shouldAnnounce({ announcePreference: true, speakerId: 'a', previousSpeakerId: undefined }), true);
    assert.equal(shouldAnnounce({ announcePreference: true, speakerId: 'a', previousSpeakerId: 'b' }), true);
  });

  it('stays quiet for consecutive messages from the same speaker', () => {
    assert.equal(shouldAnnounce({ announcePreference: true, speakerId: 'a', previousSpeakerId: 'a' }), false);
  });

  it('respects a speaker who turned the setting off', () => {
    assert.equal(shouldAnnounce({ announcePreference: false, speakerId: 'a', previousSpeakerId: 'b' }), false);
  });
});

describe('composeUtterance', () => {
  it('prefixes the name when announcing', () => {
    assert.equal(composeUtterance({ text: 'hi all', speakerName: 'Alex', announce: true }), 'Alex says, hi all');
  });

  it('reads the text alone when not announcing or the name is unpronounceable', () => {
    assert.equal(composeUtterance({ text: 'hi all', speakerName: 'Alex', announce: false }), 'hi all');
    assert.equal(composeUtterance({ text: 'hi all', speakerName: undefined, announce: true }), 'hi all');
  });
});
