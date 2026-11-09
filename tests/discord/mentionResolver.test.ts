import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Guild } from 'discord.js';
import { LOOKUP_TIMEOUT_MS, buildMentionResolver, mentionedIds } from '../../src/discord/mentionResolver.ts';
import { USER_MENTION } from '../../src/text/sanitize.ts';

const SAM = '111111111111111111';
const KAI = '111111111111111112';

describe('mentionedIds', () => {
  it('returns each mentioned id once', () => {
    assert.deepEqual(mentionedIds(`<@${SAM}> <@!${SAM}> <@${KAI}>`, USER_MENTION), [SAM, KAI]);
  });
});

describe('buildMentionResolver', () => {
  it('fetches uncached members, then resolves pronounceable names', async () => {
    const cache = new Map<string, { displayName: string }>([[SAM, { displayName: 'Sam 🎮' }]]);
    const fetched: string[] = [];
    const guild = {
      members: {
        cache,
        fetch: async (id: string) => {
          fetched.push(id);
          cache.set(id, { displayName: 'Kai' });
        },
      },
      roles: { cache: new Map([['5', { name: 'Raid Team' }]]) },
      channels: { cache: new Map([['6', { name: 'general' }]]) },
      client: { users: { cache: new Map() } },
    } as unknown as Guild;

    const resolver = await buildMentionResolver(guild, `<@${SAM}> <@${KAI}>`);
    assert.deepEqual(fetched, [KAI]);
    assert.equal(resolver.user(SAM), 'Sam');
    assert.equal(resolver.user(KAI), 'Kai');
    assert.equal(resolver.role('5'), 'Raid Team');
    assert.equal(resolver.channel('6'), 'general');
    assert.equal(resolver.user('999'), undefined);
  });

  it('gives up on slow lookups so the command can still answer in time', async () => {
    const guild = {
      members: { cache: new Map(), fetch: () => new Promise(() => undefined) },
      roles: { cache: new Map() },
      channels: { cache: new Map() },
      client: { users: { cache: new Map() } },
    } as unknown as Guild;
    const started = performance.now();
    const resolver = await buildMentionResolver(guild, `<@${SAM}>`);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= LOOKUP_TIMEOUT_MS - 50 && elapsed < LOOKUP_TIMEOUT_MS + 500, `took ${elapsed} ms`);
    assert.equal(resolver.user(SAM), undefined);
  });
});
