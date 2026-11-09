import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logging/logger.ts';
import { serialize } from '../util/serialize.ts';
import { ProductionRates, type RatesSnapshot } from './playbackBuffer.ts';

/** Batch saves: a message records a rate and a pace at once. */
const SAVE_DELAY_MS = 5_000;

const positiveNumbers = z.record(z.string(), z.number().positive().finite());
const snapshotSchema = z.object({ rates: positiveNumbers, paces: positiveNumbers });

async function readSnapshot(filePath: string, logger: Logger): Promise<RatesSnapshot | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return snapshotSchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    logger.warn('Ignoring an unreadable speech stats file; speeds will be learned again', { filePath, error });
    return undefined;
  }
}

/**
 * ProductionRates that survive restarts: loaded from `filePath` and saved back
 * (batched) whenever they change, so the buffer only has to guess once per voice.
 */
export async function loadProductionRates(filePath: string, logger: Logger): Promise<ProductionRates> {
  const snapshot = await readSnapshot(filePath, logger);
  const save = serialize(async (data: RatesSnapshot) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}
`, 'utf8');
    await rename(temporary, filePath);
  });
  let pending: NodeJS.Timeout | undefined;
  const rates: ProductionRates = new ProductionRates(snapshot, () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      save(rates.snapshot()).catch((error: unknown) => logger.warn('Could not save speech stats', { filePath, error }));
    }, SAVE_DELAY_MS);
    pending.unref();
  });
  return rates;
}
