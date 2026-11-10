import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { communityVoicesCommand } from '../../src/commands/communityVoices.ts';
import { myVoicesCommand } from '../../src/commands/myVoices/index.ts';
import { CONSENT_RULE } from '../../src/commands/myVoices/manage.ts';
import { ADD_MODAL_ID, progressContent } from '../../src/commands/myVoices/upload.ts';
import { createModelCatalog } from '../../src/tts/modelCatalog.ts';
import { POCKET_VOICES } from '../../src/tts/models/pocket/voices.ts';
import { createUserVoiceSync } from '../../src/userVoices/catalogVoices.ts';
import { loadedModel } from '../helpers/catalog.ts';
import {
  USER_ID,
  commandContext,
  contentOf,
  fakeAutocomplete,
  fakeComponent,
  fakeInteraction,
  fakeModalSubmit,
  isEphemeral,
  memoryPreferences,
  type Reply,
} from '../helpers/fakes.ts';
import { fakeUserVoices } from '../helpers/userVoices.ts';

const CLIP = { name: 'grumpy.ogg', size: 2000, contentType: 'audio/ogg', url: 'https://cdn/grumpy.ogg' };

/** A context whose Pocket model lists uploaded voices, as in production. */
function setup() {
  const userVoices = fakeUserVoices();
  const catalog = createModelCatalog([loadedModel('pocket', 'Pocket TTS', POCKET_VOICES, 'alba')], 'pocket');
  createUserVoiceSync(catalog, userVoices.store);
  const preferences = memoryPreferences({}, catalog);
  return { userVoices, catalog, preferences, context: commandContext({ catalog, preferences, userVoices: userVoices.service }) };
}

async function addVoice(context: ReturnType<typeof setup>['context'], name: string): Promise<Reply[]> {
  const interaction = fakeInteraction({ commandName: 'myvoices', subcommand: 'add', strings: { name }, attachments: { clip: CLIP } });
  await myVoicesCommand.execute(interaction, context);
  return interaction.replies;
}

const lastContent = (replies: Reply[]): string => contentOf(replies.at(-1));

describe('/myvoices add', () => {
  it('opens the form with tips when no clip is attached', async () => {
    const { context } = setup();
    const interaction = fakeInteraction({ commandName: 'myvoices', subcommand: 'add', strings: { name: 'Grumpy' } });
    await myVoicesCommand.execute(interaction, context);
    const modal = JSON.stringify(interaction.modals[0]);
    assert.ok(modal.includes(ADD_MODAL_ID));
    assert.ok(modal.includes('Tips for the best result'));
    assert.ok(modal.includes('"value":"Grumpy"'), 'the name is prefilled');
    assert.deepEqual(interaction.replies, []);
  });

  it('uploads an attached clip privately, showing progress, then the preview and a Use it now button', async () => {
    const { context, userVoices } = setup();
    const replies = await addVoice(context, 'Grumpy Narrator');
    assert.equal(isEphemeral(replies[0]), true, 'deferred privately');
    assert.ok(replies.some((reply) => /Downloading your clip/.test(contentOf(reply))));
    const final = replies.at(-1)?.payload as { content: string; files: { name: string }[]; components: { toJSON(): unknown }[] };
    assert.match(final.content, /\*\*Grumpy Narrator\*\* is ready/);
    assert.equal(final.files[0]?.name, 'aaaaaaaaaaaaa-preview.wav');
    assert.match(JSON.stringify(final.components[0]?.toJSON()), /myvoices:use:aaaaaaaaaaaaa/);
    assert.equal(userVoices.service.voicesOf(USER_ID)[0]?.name, 'Grumpy Narrator');
  });

  it('names a directly attached clip after its file when no name is given', async () => {
    const { context, userVoices } = setup();
    await myVoicesCommand.execute(fakeInteraction({ commandName: 'myvoices', subcommand: 'add', attachments: { clip: CLIP } }), context);
    assert.equal(userVoices.service.voicesOf(USER_ID)[0]?.name, 'grumpy');
  });

  it('uploads from the submitted form', async () => {
    const { context, userVoices } = setup();
    const submit = fakeModalSubmit(ADD_MODAL_ID, { text: { name: 'From Form' }, files: { clip: [CLIP] } });
    await myVoicesCommand.modal?.(submit, context);
    assert.match(lastContent(submit.replies), /From Form\*\* is ready/);
    assert.equal(userVoices.service.voicesOf(USER_ID).length, 1);
  });

  it('reports problems in place of the progress line', async () => {
    const { context } = setup();
    const replies = await addVoice(context, '**');
    assert.match(lastContent(replies), /^❌/);
  });

  it('describes each stage with a bar', () => {
    assert.equal(progressContent('Grumpy', { stage: 'waiting', ahead: 2 }), '**Adding Grumpy**\n⏳ Waiting for other uploads to finish (2 uploads ahead of yours) ▰▱▱▱▱▱▱▱▱▱ 5%');
  });
});

describe('managing voices with /myvoices', () => {
  it('lists, renames and autocompletes the user\'s own voices', async () => {
    const { context } = setup();
    await addVoice(context, 'Grumpy');
    const list = fakeInteraction({ commandName: 'myvoices', subcommand: 'list' });
    await myVoicesCommand.execute(list, context);
    assert.match(contentOf(list.replies[0]), /Your voices \(1\/5\)\*\*\n• \*\*Grumpy\*\* · 12 s · private/);

    const rename = fakeInteraction({ commandName: 'myvoices', subcommand: 'rename', strings: { voice: 'aaaaaaaaaaaaa', name: 'Cheerful' } });
    await myVoicesCommand.execute(rename, context);
    assert.equal(contentOf(rename.replies[0]), 'Renamed to **Cheerful**.');

    const suggestions = fakeAutocomplete('myvoices', 'che');
    await myVoicesCommand.autocomplete?.(suggestions, context);
    assert.deepEqual(suggestions.responses, [[{ name: 'Cheerful', value: 'aaaaaaaaaaaaa' }]]);
  });

  it('asks before publishing, stating the consent rule, then publishes under the username', async () => {
    const { context, userVoices } = setup();
    await addVoice(context, 'Grumpy');
    const ask = fakeInteraction({ commandName: 'myvoices', subcommand: 'publish', strings: { voice: 'Grumpy' } });
    await myVoicesCommand.execute(ask, context);
    assert.ok(contentOf(ask.replies[0]).includes(CONSENT_RULE));
    assert.match(contentOf(ask.replies[0]), /as \*\*Grumpy by alex\\_user\*\*/);
    assert.equal(userVoices.service.voicesOf(USER_ID)[0]?.published, undefined, 'nothing happens before confirming');

    const confirm = fakeComponent('myvoices:publish:aaaaaaaaaaaaa');
    await myVoicesCommand.component?.(confirm, context);
    assert.match((confirm.updates[0] as { content: string }).content, /now in Community Voices/);
    assert.equal(userVoices.service.voicesOf(USER_ID)[0]?.published?.authorUsername, 'alex_user');

    const unpublish = fakeInteraction({ commandName: 'myvoices', subcommand: 'unpublish', strings: { voice: 'Grumpy' } });
    await myVoicesCommand.execute(unpublish, context);
    assert.match(contentOf(unpublish.replies[0]), /no longer in Community Voices/);
  });

  it('asks before deleting, and can be cancelled', async () => {
    const { context, userVoices } = setup();
    await addVoice(context, 'Grumpy');
    const ask = fakeInteraction({ commandName: 'myvoices', subcommand: 'delete', strings: { voice: 'Grumpy' } });
    await myVoicesCommand.execute(ask, context);
    assert.match(contentOf(ask.replies[0]), /Delete \*\*Grumpy\*\*\? This can't be undone/);
    const cancel = fakeComponent('myvoices:cancel');
    await myVoicesCommand.component?.(cancel, context);
    assert.equal((cancel.updates[0] as { content: string }).content, 'Cancelled.');
    const confirm = fakeComponent('myvoices:delete:aaaaaaaaaaaaa');
    await myVoicesCommand.component?.(confirm, context);
    assert.equal((confirm.updates[0] as { content: string }).content, 'Deleted **Grumpy**.');
    assert.deepEqual(userVoices.service.voicesOf(USER_ID), []);
  });

  it('switches to the new voice with the Use it now button', async () => {
    const { context, preferences } = setup();
    await addVoice(context, 'Grumpy');
    const use = fakeComponent('myvoices:use:aaaaaaaaaaaaa');
    await myVoicesCommand.component?.(use, context);
    assert.deepEqual(preferences.get(USER_ID).voice, 'user:aaaaaaaaaaaaa');
    assert.equal(preferences.get(USER_ID).model, 'pocket');
  });
});

describe('/communityvoices', () => {
  it('opens the picker on Community Voices without a query', async () => {
    const { context } = setup();
    const interaction = fakeInteraction({ commandName: 'communityvoices' });
    await communityVoicesCommand.execute(interaction, context);
    assert.match(contentOf(interaction.replies[0]), /Showing All voices|Community Voices/);
  });

  it('finds published voices by name or author and switches to them', async () => {
    const { context, preferences } = setup();
    await addVoice(context, 'Grumpy');
    await myVoicesCommand.component?.(fakeComponent('myvoices:publish:aaaaaaaaaaaaa'), context);
    const suggestions = fakeAutocomplete('communityvoices', 'alex_user');
    await communityVoicesCommand.autocomplete?.(suggestions, context);
    assert.deepEqual(suggestions.responses, [[{ name: 'Grumpy by alex_user · Pocket TTS', value: 'pocket:user:aaaaaaaaaaaaa' }]]);
    const pick = fakeInteraction({ commandName: 'communityvoices', strings: { query: 'pocket:user:aaaaaaaaaaaaa' } });
    await communityVoicesCommand.execute(pick, context);
    assert.equal(preferences.get(USER_ID).voice, 'user:aaaaaaaaaaaaa');
  });
});
