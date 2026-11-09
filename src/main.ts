import path from 'node:path';
import { Events } from 'discord.js';
import { createCommands } from './commands/index.ts';
import { ConfigError, parseConfig, type Config } from './config/config.ts';
import { createDiscordClient } from './discord/client.ts';
import { createInteractionHandler } from './discord/interactionRouter.ts';
import { registerCommands } from './discord/registerCommands.ts';
import { handleVoiceStateUpdate } from './discord/voiceStateWatcher.ts';
import { createLogger, type Logger } from './logging/logger.ts';
import { createGuildSpeakers } from './playback/guildSpeakers.ts';
import { loadPreferenceStore } from './preferences/preferenceStore.ts';
import { createKokoroEngine } from './tts/kokoroEngine.ts';

function loadConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error: unknown) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function start(config: Config, logger: Logger): Promise<void> {
  const loadStarted = performance.now();
  const engine = await createKokoroEngine({
    modelDir: config.modelDir,
    numThreads: config.ttsThreads,
    speed: config.ttsSpeed,
  });
  logger.info('Kokoro model loaded', { modelDir: config.modelDir, ms: Math.round(performance.now() - loadStarted) });

  const preferences = await loadPreferenceStore({
    filePath: path.join(config.dataDir, 'preferences.json'),
    defaults: { voice: config.defaultVoice, announceName: true },
    logger,
  });
  const speakers = createGuildSpeakers({
    engine,
    logger,
    maxQueueLength: config.maxQueueLength,
    idleTimeoutMs: config.idleTimeoutMs,
  });
  const commands = createCommands(config);
  const client = createDiscordClient();
  const handleInteraction = createInteractionHandler(commands, { config, speakers, preferences, logger });

  client.once(Events.ClientReady, (ready) => {
    logger.info('Connected to Discord', { user: ready.user.tag, guilds: ready.guilds.cache.size });
    registerCommands(ready, commands, config.guildId, logger).catch((error: unknown) => {
      logger.error('Failed to register slash commands', { error });
    });
  });
  client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
  client.on(Events.VoiceStateUpdate, (_previous, current) => handleVoiceStateUpdate(current, speakers, logger));
  client.on(Events.Error, (error) => logger.error('Discord client error', { error }));

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    speakers.disconnectAll();
    void client.destroy().finally(() => process.exit(0));
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  await client.login(config.discordToken);
}

const config = loadConfig();
const logger = createLogger(config.logLevel);
start(config, logger).catch((error: unknown) => {
  logger.error('Fatal startup error', { error });
  process.exit(1);
});
