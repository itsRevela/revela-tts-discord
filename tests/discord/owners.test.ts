import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applicationOwnerIds, resolveOwners } from '../../src/discord/owners.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { testConfig } from '../helpers/fakes.ts';

describe('bot owners for moderation', () => {
  it('reads the application owner, or every team member', () => {
    assert.deepEqual(applicationOwnerIds({ owner: { id: '300000000000000001' } } as never), ['300000000000000001']);
    assert.deepEqual(
      applicationOwnerIds({ team: { members: [{ user: { id: '1' } }, { user: { id: '2' } }] } } as never),
      ['1', '2'],
    );
  });

  it('keeps OWNER_USER_IDS when set, and otherwise asks Discord', async () => {
    const asked: string[] = [];
    const rest = { get: async (route: string) => (asked.push(route), { owner: { id: '300000000000000005' } }) };
    const configured = testConfig({ OWNER_USER_IDS: '300000000000000009' });
    assert.equal(await resolveOwners(configured, silentLogger, rest as never), configured);
    const resolved = await resolveOwners(testConfig(), silentLogger, rest as never);
    assert.deepEqual(resolved.ownerUserIds, ['300000000000000005']);
    assert.deepEqual(asked, ['/applications/@me']);
  });

  it('leaves moderation off if Discord cannot be asked', async () => {
    const rest = { get: async () => { throw new Error('offline'); } };
    assert.deepEqual((await resolveOwners(testConfig(), silentLogger, rest as never)).ownerUserIds, []);
  });
});
