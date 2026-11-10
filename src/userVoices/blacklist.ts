import { readFile } from 'node:fs/promises';
import type { Logger } from '../logging/logger.ts';
import { matchKey, wordKeys } from './names.ts';

/**
 * Words that published community voice names may not contain. The file has one
 * term per line; "#" starts a comment. A plain term blocks any name containing
 * it (after folding case, accents, look-alikes and leetspeak); a term starting
 * with "=" only blocks it as a whole word, for short words that appear inside
 * harmless ones.
 */
export interface Blacklist {
  readonly size: number;
  blocks(name: string): boolean;
}

export function parseBlacklist(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

export function createBlacklist(terms: readonly string[]): Blacklist {
  const whole = new Set(terms.filter((term) => term.startsWith('=')).map((term) => matchKey(term.slice(1))).filter(Boolean));
  const anywhere = terms.filter((term) => !term.startsWith('=')).map(matchKey).filter(Boolean);
  return {
    size: whole.size + anywhere.length,
    blocks: (name) => {
      const key = matchKey(name);
      return anywhere.some((term) => key.includes(term)) || wordKeys(name).some((word) => whole.has(word)) || whole.has(key);
    },
  };
}

/** Loads the blacklist file; a missing file blocks nothing and is logged, so the owner notices. */
export async function loadBlacklist(filePath: string, logger: Logger): Promise<Blacklist> {
  try {
    const blacklist = createBlacklist(parseBlacklist(await readFile(filePath, 'utf8')));
    logger.info('Loaded the community voice name blacklist', { terms: blacklist.size });
    return blacklist;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      logger.warn('No community voice name blacklist; published names are not filtered', { filePath });
      return createBlacklist([]);
    }
    throw error;
  }
}
