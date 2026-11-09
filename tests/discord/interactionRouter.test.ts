import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Interaction } from 'discord.js';
import type { SlashCommand } from '../../src/commands/types.ts';
import { createInteractionHandler } from '../../src/discord/interactionRouter.ts';
import { commandContext, contentOf, fakeAutocomplete, fakeComponent, fakeInteraction, isEphemeral } from '../helpers/fakes.ts';

function command(execute: SlashCommand['execute'], autocomplete?: SlashCommand['autocomplete']): SlashCommand {
  const data = { name: 'tts', description: 'test' };
  return autocomplete ? { data, execute, autocomplete } : { data, execute };
}

describe('createInteractionHandler', () => {
  it('runs the matching command', async () => {
    let ran = 0;
    const handle = createInteractionHandler(new Map([['tts', command(async () => { ran += 1; })]]), commandContext());
    await handle(fakeInteraction() as unknown as Interaction);
    assert.equal(ran, 1);
  });

  it('replies with an ephemeral error when a command throws', async () => {
    const handle = createInteractionHandler(new Map([['tts', command(async () => { throw new Error('boom'); })]]), commandContext());
    const interaction = fakeInteraction();
    await handle(interaction as unknown as Interaction);
    assert.match(contentOf(interaction.replies[0]), /Something went wrong/);
    assert.equal(isEphemeral(interaction.replies[0]), true);
  });

  it('edits the deferred reply when a command fails after deferring', async () => {
    const failing = command(async (interaction) => {
      await interaction.deferReply();
      throw new Error('boom');
    });
    const interaction = fakeInteraction();
    await createInteractionHandler(new Map([['tts', failing]]), commandContext())(interaction as unknown as Interaction);
    assert.equal(interaction.replies.at(-1)?.kind, 'edit');
  });

  it('ignores unknown commands', async () => {
    const interaction = fakeInteraction({ commandName: 'nope' });
    await createInteractionHandler(new Map(), commandContext())(interaction as unknown as Interaction);
    assert.equal(interaction.replies.length, 0);
  });

  it('routes autocomplete requests', async () => {
    const seen: string[] = [];
    const handle = createInteractionHandler(
      new Map([['tts', command(async () => undefined, async (interaction) => { seen.push(interaction.options.getFocused()); })]]),
      commandContext(),
    );
    await handle(fakeAutocomplete('tts', 'he') as unknown as Interaction);
    assert.deepEqual(seen, ['he']);
  });
});

describe('component routing', () => {
  it('sends picker clicks to the command named in the custom id', async () => {
    const seen: string[] = [];
    const voice: SlashCommand = {
      data: { name: 'voice', description: 'test' },
      execute: async () => undefined,
      component: async (interaction) => { seen.push(interaction.customId); },
    };
    const handle = createInteractionHandler(new Map([['voice', voice]]), commandContext());
    await handle(fakeComponent('voice:next:all:0') as unknown as Interaction);
    await handle(fakeComponent('other:next:all:0') as unknown as Interaction);
    assert.deepEqual(seen, ['voice:next:all:0']);
  });
});
