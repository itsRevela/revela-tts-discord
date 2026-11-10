import path from 'node:path';
import type { Config } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import type { ModelCatalog } from '../tts/modelCatalog.ts';
import { POCKET_SERVER } from '../tts/models/pocket/settings.ts';
import { speechServerSettings } from '../tts/speechServer/settings.ts';
import { loadBlacklist } from './blacklist.ts';
import type { CatalogStore } from './catalogStore.ts';
import { createPocketVoiceClient } from './pocketClient.ts';
import { reservedVoiceNames } from './reservedNames.ts';
import { createUserVoiceService, type UserVoiceService } from './service.ts';

/** Where uploaded clips live: data/user-voices/<id>/source.<ext>, shared read-only with the Pocket server. */
export const userVoicesDirectory = (config: Config): string => path.join(config.dataDir, 'user-voices');

/** Builds the upload service: blacklist file, Pocket client, limits; and clears folders left by a crash mid-upload. */
export async function setUpUserVoices(
  config: Config,
  store: CatalogStore,
  models: ModelCatalog,
  logger: Logger,
  isBanned: (userId: string) => boolean,
): Promise<UserVoiceService> {
  const service = createUserVoiceService({
    store,
    pocket: createPocketVoiceClient(speechServerSettings(process.env, POCKET_SERVER).url),
    directory: userVoicesDirectory(config),
    settings: config.userVoices,
    blacklist: await loadBlacklist(path.join(config.dataDir, 'name-blacklist.txt'), logger),
    reservedNames: () => reservedVoiceNames(models),
    isBanned,
    logger,
  });
  const orphans = await service.removeOrphans();
  if (orphans > 0) logger.info('Removed upload folders left by unfinished uploads', { folders: orphans });
  return service;
}
