import { REST, Routes, type APIApplication } from 'discord.js';
import type { Config } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';

/** The application's owner, or every member of the team that owns it. */
export function applicationOwnerIds(application: Pick<APIApplication, 'owner' | 'team'>): readonly string[] {
  if (application.team) return application.team.members.map((member) => member.user.id);
  return application.owner ? [application.owner.id] : [];
}

/**
 * OWNER_USER_IDS when set; otherwise whoever owns the bot's Discord
 * application, so moderation works without extra setup.
 */
export async function resolveOwners(config: Config, logger: Logger, rest: Pick<REST, 'get'> = new REST().setToken(config.discordToken)): Promise<Config> {
  if (config.ownerUserIds.length > 0) return config;
  try {
    const application = (await rest.get(Routes.currentApplication())) as APIApplication;
    const ownerUserIds = applicationOwnerIds(application);
    logger.info('Community voice moderators: the bot application owner', { owners: ownerUserIds.length });
    return Object.freeze({ ...config, ownerUserIds });
  } catch (error: unknown) {
    logger.warn('Could not look up the bot owner; set OWNER_USER_IDS to enable /voicemod', { error });
    return config;
  }
}
