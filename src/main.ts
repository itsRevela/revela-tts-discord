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
import { loadProductionRates } from './playback/rateStore.ts';
import { preferenceDefaultsFor } from './preferences/catalogDefaults.ts';
import { loadPreferenceStore } from './preferences/preferenceStore.ts';
import { loadInBackground } from './tts/backgroundModels.ts';
import { loadModels } from './tts/loadModels.ts';
import { createModelCatalog, type ModelCatalog } from './tts/modelCatalog.ts';
import { findModelDefinition } from './tts/modelRegistry.ts';
import { createSynthesizer } from './tts/synthesizer.ts';
import { settleReplyDeletions } from './discord/replyCleanup.ts';
import type { TtsModel } from './tts/types.ts';

/** Docker allows 10 s between SIGTERM and SIGKILL. */
const SHUTDOWN_DELETE_WAIT_MS = 5_000;

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

/**
 * Loads in-process models now and server-backed ("remote") ones in the
 * background; the latter join the catalog when their server is ready.
 */
async function loadCatalog(config: Config, logger: Logger): Promise<ModelCatalog> {
  const definitions = config.models
    .map((id) => findModelDefinition(id))
    .filter((model): model is TtsModel => model !== undefined);
  // A server-backed default also loads in the background when an in-process model can stand in
  // until it is ready, so a slow or failed server never blocks startup.
  const hasLocal = definitions.some((model) => model.remote !== true);
  const inBackground = (model: TtsModel): boolean =>
    model.remote === true && (model.id !== config.defaultModel || hasLocal);
  const options = {
    modelsDir: config.modelsDir,
    customVoicesDir: path.join(config.dataDir, 'voices'),
    numThreads: config.ttsThreads,
    speed: config.ttsSpeed,
    env: process.env,
    logger,
  };
  const models = await loadModels(definitions.filter((model) => !inBackground(model)), {
    ...options,
    required: [config.defaultModel],
  });
  const catalog = createModelCatalog(models, config.defaultModel, config.models);
  loadInBackground(definitions.filter(inBackground), options, (model) => {
    catalog.add(model);
    logger.info('Model joined /voice', { model: model.id, voices: model.voices.length });
  });
  return catalog;
}

async function start(config: Config, logger: Logger): Promise<void> {
  const catalog = await loadCatalog(config, logger);
  const preferences = await loadPreferenceStore({
    filePath: path.join(config.dataDir, 'preferences.json'),
    defaults: preferenceDefaultsFor(catalog, config.defaultVoice),
    logger,
  });
  const speakers = createGuildSpeakers({
    synthesizer: createSynthesizer(catalog),
    rates: await loadProductionRates(path.join(config.dataDir, 'speech-stats.json'), logger),
    logger,
    maxQueueLength: config.maxQueueLength,
    idleTimeoutMs: config.idleTimeoutMs,
  });
  const commands = createCommands(config);
  const client = createDiscordClient();
  const handleInteraction = createInteractionHandler(commands, { config, speakers, preferences, catalog, logger });

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
    // Leaving drops queued speech, which deletes those /tts replies; let that finish first.
    speakers.disconnectAll();
    void settleReplyDeletions(SHUTDOWN_DELETE_WAIT_MS)
      .then(() => client.destroy())
      .finally(() => process.exit(0));
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
