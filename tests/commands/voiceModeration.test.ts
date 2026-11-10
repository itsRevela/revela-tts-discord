import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { myVoicesCommand } from '../../src/commands/myVoices/index.ts';
import { createReportVoiceCommand } from '../../src/commands/reportVoice.ts';
import { voiceModCommand } from '../../src/commands/voiceMod.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import { createAttemptLimiter } from '../../src/unlock/attemptLimiter.ts';
import { MAX_REPORTS, loadModerationStore } from '../../src/userVoices/moderation.ts';
import { USER_ID, commandContext, contentOf, fakeComponent, fakeInteraction, testConfig } from '../helpers/fakes.ts';
import { fakeUserVoices, memoryModeration } from '../helpers/userVoices.ts';

const OWNER = '300000000000000099';
const CLIP = { name: 'v.ogg', size: 2000, contentType: 'audio/ogg', url: 'https://cdn/v.ogg' };

/** Alex has one published voice ("Grumpy", id aaaaaaaaaaaaa); OWNER moderates. */
async function setup(modLog?: string) {
  const userVoices = fakeUserVoices();
  const moderation = memoryModeration();
  const config = testConfig({ OWNER_USER_IDS: OWNER, ...(modLog ? { MOD_LOG_CHANNEL_ID: modLog } : {}) });
  const context = commandContext({ config, userVoices: userVoices.service, moderation });
  await myVoicesCommand.execute(fakeInteraction({ commandName: 'myvoices', subcommand: 'add', strings: { name: 'Grumpy' }, attachments: { clip: CLIP } }), context);
  await myVoicesCommand.component?.(fakeComponent('myvoices:publish:aaaaaaaaaaaaa'), context);
  return { context, userVoices, moderation };
}

const asOwner = (subcommand: string, extra: Parameters<typeof fakeInteraction>[0] = {}) =>
  fakeInteraction({ commandName: 'voicemod', subcommand, userId: OWNER, ...extra });

describe('/voicemod', () => {
  it('refuses anyone who is not an owner', async () => {
    const { context } = await setup();
    const interaction = fakeInteraction({ commandName: 'voicemod', subcommand: 'list' });
    await voiceModCommand.execute(interaction, context);
    assert.match(contentOf(interaction.replies[0]), /Only the bot's owners/);
    assert.equal(voiceModCommand.data.default_member_permissions, '0');
  });

  it('takes a community voice down and tells its author why', async () => {
    const { context, userVoices } = await setup();
    const interaction = asOwner('takedown', { strings: { voice: 'aaaaaaaaaaaaa', reason: 'impersonation' } });
    await voiceModCommand.execute(interaction, context);
    assert.match(contentOf(interaction.replies[0]), /Removed \*\*Grumpy\*\* by alex\\_user/);
    assert.deepEqual(interaction.dms, [`${USER_ID}: Your community voice **Grumpy** was removed by a moderator. Reason: impersonation`]);
    assert.deepEqual(userVoices.service.allVoices(), []);
  });

  it('bans uploaders (unpublishing their voices) and lifts bans', async () => {
    const { context, userVoices, moderation } = await setup();
    const banning = asOwner('ban', { users: { user: { id: USER_ID } }, strings: { reason: 'spam' } });
    await voiceModCommand.execute(banning, context);
    assert.match(contentOf(banning.replies[0]), /1 of their voices left Community Voices/);
    assert.equal(moderation.isBanned(USER_ID), true);
    assert.deepEqual(userVoices.service.publishedVoices(), []);

    const unbanning = asOwner('unban', { users: { user: { id: USER_ID } } });
    await voiceModCommand.execute(unbanning, context);
    assert.match(contentOf(unbanning.replies[0]), /can upload and publish voices again/);
    assert.equal(moderation.isBanned(USER_ID), false);
  });

  it('lists uploads with ids and counts reports', async () => {
    const { context } = await setup();
    const interaction = asOwner('list');
    await voiceModCommand.execute(interaction, context);
    assert.match(contentOf(interaction.replies[0]), /^\*\*1 uploaded voice\*\* · 0 reports on file\n• \*\*Grumpy\*\* `aaaaaaaaaaaaa`/);
  });
});

describe('/reportvoice', () => {
  it('records the report and posts it to the mod log channel', async () => {
    const { context, moderation } = await setup('200000000000000077');
    const report = createReportVoiceCommand();
    const interaction = fakeInteraction({ commandName: 'reportvoice', strings: { voice: 'pocket:user:aaaaaaaaaaaaa', reason: 'sounds like a real person' } });
    await report.execute(interaction, context);
    assert.match(contentOf(interaction.replies[0]), /report was sent/);
    assert.equal(moderation.get().reports[0]?.voiceId, 'aaaaaaaaaaaaa');
    assert.match(interaction.posts[0] ?? '', /^200000000000000077: 🚩 \*\*Grumpy\*\* by alex\\_user/);
  });

  it('refuses voices that are not in the community, and limits reports per person', async () => {
    const { context } = await setup();
    const report = createReportVoiceCommand(createAttemptLimiter({ maxFailures: 1, windowMs: 60_000, now: () => 0 }));
    const unknown = fakeInteraction({ commandName: 'reportvoice', strings: { voice: 'pocket:alba', reason: 'x' } });
    await report.execute(unknown, context);
    assert.match(contentOf(unknown.replies[0]), /Pick a community voice/);
    const first = fakeInteraction({ commandName: 'reportvoice', strings: { voice: 'pocket:user:aaaaaaaaaaaaa', reason: 'x' } });
    await report.execute(first, context);
    const second = fakeInteraction({ commandName: 'reportvoice', strings: { voice: 'pocket:user:aaaaaaaaaaaaa', reason: 'x' } });
    await report.execute(second, context);
    assert.match(contentOf(second.replies[0]), /several reports already/);
  });
});

describe('moderation file', () => {
  it('saves bans and reports, keeping only the newest reports', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moderation-'));
    try {
      const filePath = path.join(directory, 'moderation.json');
      const store = await loadModerationStore(filePath, silentLogger);
      await store.ban(USER_ID, { at: 'now', byUserId: OWNER });
      for (let index = 0; index < MAX_REPORTS + 2; index += 1) {
        await store.report({ at: String(index), voiceId: 'aaaaaaaaaaaaa', reporterId: OWNER, reason: 'r' });
      }
      const reloaded = await loadModerationStore(filePath, silentLogger);
      assert.equal(reloaded.isBanned(USER_ID), true);
      assert.equal(reloaded.get().reports.length, MAX_REPORTS);
      assert.equal(reloaded.get().reports[0]?.at, '2');
      assert.equal(await reloaded.unban(USER_ID), true);
      assert.equal(await reloaded.unban(USER_ID), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
