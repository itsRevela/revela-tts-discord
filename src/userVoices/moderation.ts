import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logging/logger.ts';
import { serialize } from '../util/serialize.ts';

/** Who may not upload or publish, and what people reported. Kept in data/user-voices/moderation.json. */
export interface Ban {
  readonly at: string;
  readonly byUserId: string;
  readonly reason?: string;
}

export interface Report {
  readonly at: string;
  readonly voiceId: string;
  readonly reporterId: string;
  readonly reason: string;
}

export interface ModerationRecord {
  readonly bans: Readonly<Record<string, Ban>>;
  readonly reports: readonly Report[];
}

/** Older reports are dropped beyond this many, so the file stays small. */
export const MAX_REPORTS = 500;

const SNOWFLAKE = /^\d{17,20}$/;
const recordSchema = z.object({
  bans: z.record(z.string().regex(SNOWFLAKE), z.object({ at: z.string(), byUserId: z.string(), reason: z.string().optional() })),
  reports: z.array(z.object({ at: z.string(), voiceId: z.string(), reporterId: z.string(), reason: z.string() })),
});

const EMPTY: ModerationRecord = { bans: {}, reports: [] };

export interface ModerationStore {
  isBanned(userId: string): boolean;
  ban(userId: string, ban: Ban): Promise<void>;
  unban(userId: string): Promise<boolean>;
  report(report: Report): Promise<void>;
  get(): ModerationRecord;
}

export async function loadModerationStore(filePath: string, logger: Logger): Promise<ModerationStore> {
  let record = await readFile(filePath, 'utf8')
    .then((raw) => recordSchema.parse(JSON.parse(raw)) as ModerationRecord)
    .catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        logger.error('Moderation file was unreadable; starting empty', { filePath, error });
      }
      return EMPTY;
    });
  const save = serialize(async (next: ModerationRecord) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(`${filePath}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(`${filePath}.tmp`, filePath);
    record = next;
  });
  return {
    get: () => record,
    isBanned: (userId) => record.bans[userId] !== undefined,
    ban: (userId, ban) => save({ ...record, bans: { ...record.bans, [userId]: ban } }),
    unban: async (userId) => {
      if (!record.bans[userId]) return false;
      const { [userId]: _removed, ...bans } = record.bans;
      await save({ ...record, bans });
      return true;
    },
    report: (report) => save({ ...record, reports: [...record.reports, report].slice(-MAX_REPORTS) }),
  };
}
