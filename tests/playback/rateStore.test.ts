import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { silentLogger } from '../../src/logging/logger.ts';
import { loadProductionRates } from '../../src/playback/rateStore.ts';

describe('loadProductionRates', () => {
  let directory = '';
  let filePath = '';

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tts-stats-'));
    filePath = path.join(directory, 'speech-stats.json');
  });

  afterEach(async () => {
    mock.timers.reset();
    await rm(directory, { recursive: true, force: true });
  });

  it('starts empty without a file, saves after a short delay, and loads it back', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const rates = await loadProductionRates(filePath, silentLogger);
    assert.equal(rates.get('neutts'), undefined);
    rates.record('neutts', 0.56);
    rates.recordPace('neutts', 'custom:moistcr1tikal', 0.057);
    mock.timers.tick(5_000);
    mock.timers.reset();
    // The save itself is asynchronous file I/O.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        JSON.parse(await readFile(filePath, 'utf8'));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const reloaded = await loadProductionRates(filePath, silentLogger);
    assert.equal(reloaded.get('neutts'), 0.56);
    assert.equal(reloaded.pace('neutts', 'custom:moistcr1tikal'), 0.057);
  });

  it('ignores an unreadable file', async () => {
    await writeFile(filePath, '{"rates": {"neutts": -1}, "paces": {}}', 'utf8');
    const rates = await loadProductionRates(filePath, silentLogger);
    assert.equal(rates.get('neutts'), undefined);
  });
});
