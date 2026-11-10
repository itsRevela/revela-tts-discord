import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import { preferenceDefaultsFor } from '../../src/preferences/catalogDefaults.ts';
import { loadPreferenceStore } from '../../src/preferences/preferenceStore.ts';
import { testCatalog } from '../helpers/catalog.ts';

const DEFAULTS = preferenceDefaultsFor(testCatalog(), undefined);
const FRESH = { model: 'pocket', voice: 'alba', announceName: true, customVoices: true };
const ALEX = '300000000000000001';

describe('loadPreferenceStore', () => {
  let directory = '';
  let filePath = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tts-prefs-'));
    filePath = path.join(directory, 'nested', 'preferences.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const load = () => loadPreferenceStore({ filePath, defaults: DEFAULTS, logger: silentLogger });

  it('starts with defaults when there is no file yet', async () => {
    const store = await load();
    assert.deepEqual(store.get(ALEX), FRESH);
  });

  it('saves updates and loads them on the next start', async () => {
    const store = await load();
    const updated = await store.update(ALEX, { model: 'kokoro', voices: { kokoro: 'bm_george' } });
    await store.update(ALEX, { announceName: false });
    assert.deepEqual(updated, { model: 'kokoro', voice: 'bm_george', announceName: true, customVoices: true });

    const reloaded = await load();
    assert.deepEqual(reloaded.get(ALEX), { model: 'kokoro', voice: 'bm_george', announceName: false, customVoices: true });
    const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    assert.deepEqual(saved, { [ALEX]: { model: 'kokoro', voices: { kokoro: 'bm_george' }, announceName: false } });
  });

  it('keeps an unreadable file as a backup and starts fresh', async () => {
    const store = await load();
    await store.update(ALEX, { announceName: false });
    await writeFile(filePath, '{ not json', 'utf8');

    const recovered = await load();
    assert.deepEqual(recovered.get(ALEX), FRESH);
    const files = await readdir(path.dirname(filePath));
    assert.ok(files.some((name) => name.startsWith('preferences.json.corrupt-')));
  });

  it('fails at startup when the directory cannot be created', async () => {
    const blocker = path.join(directory, 'blocker');
    await writeFile(blocker, 'a file, not a directory', 'utf8');
    filePath = path.join(blocker, 'preferences.json');
    await assert.rejects(load(), /not writable/);
  });

  it('keeps every update when several land at once', async () => {
    const store = await load();
    await Promise.all([
      store.update(ALEX, { voices: { pocket: 'custom:rekp' } }),
      store.update('300000000000000002', { announceName: false }),
    ]);
    const reloaded = await load();
    assert.equal(reloaded.get(ALEX).voice, 'custom:rekp');
    assert.equal(reloaded.get('300000000000000002').announceName, false);
  });
});
