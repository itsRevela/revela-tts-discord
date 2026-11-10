import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBlacklist, parseBlacklist } from '../../src/userVoices/blacklist.ts';
import { isUserVoiceId, newUserVoiceId, parseUserVoiceKey, userVoiceKey } from '../../src/userVoices/ids.ts';
import { checkVoiceName, matchKey } from '../../src/userVoices/names.ts';

describe('uploaded voice ids', () => {
  it('are 13 base32 characters and round-trip through "user:<id>"', () => {
    const id = newUserVoiceId();
    assert.equal(isUserVoiceId(id), true);
    assert.equal(parseUserVoiceKey(userVoiceKey(id)), id);
    assert.equal(newUserVoiceId(() => new Uint8Array(13).fill(255)), '7777777777777');
  });

  it('rejects anything else', () => {
    assert.equal(isUserVoiceId('k7m2q4z9x3b5n'), false, '9 is not base32');
    assert.equal(parseUserVoiceKey('custom:rekp'), undefined);
    assert.equal(parseUserVoiceKey('user:../../etc'), undefined);
  });
});

describe('checkVoiceName', () => {
  it('tidies spacing and accepts letters, numbers, spaces, apostrophes and hyphens', () => {
    assert.deepEqual(checkVoiceName('  Grumpy   Narrator 2 '), { ok: true, name: 'Grumpy Narrator 2' });
    assert.deepEqual(checkVoiceName("O'Neil-Ünic"), { ok: true, name: "O'Neil-Ünic" });
  });

  it('refuses names that are too short or long, use markdown or mentions, or have no letter', () => {
    assert.equal(checkVoiceName('a').ok, false);
    assert.equal(checkVoiceName('x'.repeat(33)).ok, false);
    assert.equal(checkVoiceName('**bold**').ok, false);
    assert.equal(checkVoiceName('<@123>').ok, false);
    assert.equal(checkVoiceName('1234').ok, false);
  });
});

describe('matchKey', () => {
  it('folds case, accents, look-alikes, leetspeak and separators', () => {
    assert.equal(matchKey('Dr. Ünicode'), 'drunicode');
    assert.equal(matchKey('DR UNIC0DE'), 'drunicode');
    assert.equal(matchKey('Ѕаrаh'), 'sarah', 'Cyrillic look-alikes');
    assert.equal(matchKey('b​ad'), 'bad', 'zero-width characters');
  });
});

describe('blacklist', () => {
  const blacklist = createBlacklist(parseBlacklist('# comment\nbadword\n=ass  # whole word only\n\n'));

  it('blocks a term anywhere, through disguises', () => {
    assert.equal(blacklist.blocks('My BADWORD voice'), true);
    assert.equal(blacklist.blocks('b4d w0rd'), true);
    assert.equal(blacklist.blocks('Bаdwоrd'), true);
  });

  it('blocks "=" terms only as whole words, so harmless words stay allowed', () => {
    assert.equal(blacklist.blocks('Bass Singer'), false);
    assert.equal(blacklist.blocks('Classy'), false);
    assert.equal(blacklist.blocks('Big Ass Voice'), true);
    assert.equal(blacklist.blocks('A55'), true);
  });

  it('counts terms and blocks nothing when empty', () => {
    assert.equal(blacklist.size, 2);
    assert.equal(createBlacklist([]).blocks('anything'), false);
  });
});
