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
import { createModelCatalog, type LoadedModel, type ModelCatalog } from './tts/modelCatalog.ts';
import { findModelDefinition } from './tts/modelRegistry.ts';
import { createSynthesizer } from './tts/synthesizer.ts';
import { settleReplyDeletions } from './discord/replyCleanup.ts';
import { resolveOwners } from './discord/owners.ts';
import { handleAutoReadMessage } from './autoRead/autoReadMessages.ts';
import { loadCatalogStore } from './userVoices/catalogStore.ts';
import { createUserVoiceSync, type UserVoiceSync } from './userVoices/catalogVoices.ts';
import { loadModerationStore } from './userVoices/moderation.ts';
import { setUpUserVoices, userVoicesDirectory } from './userVoices/setup.ts';
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
async function loadCatalog(
  config: Config,
  logger: Logger,
  prepare: (model: LoadedModel) => LoadedModel,
): Promise<ModelCatalog> {
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
    const joined = prepare(model);
    catalog.add(joined);
    logger.info('Model joined /voice', { model: model.id, voices: joined.voices.length });
  });
  return catalog;
}

async function start(baseConfig: Config, logger: Logger): Promise<void> {
  const config = await resolveOwners(baseConfig, logger);
  const userVoices = await loadCatalogStore(path.join(config.dataDir, 'user-voices', 'catalog.json'), logger);
  let userVoiceSync: UserVoiceSync | undefined;
  const catalog = await loadCatalog(config, logger, (model) => userVoiceSync?.joined(model) ?? model);
  // Set before any background model can join: those callbacks run on later ticks.
  userVoiceSync = createUserVoiceSync(catalog, userVoices);
  const preferences = await loadPreferenceStore({
    filePath: path.join(config.dataDir, 'preferences.json'),
    defaults: preferenceDefaultsFor(catalog, config.defaultVoice, config.customVoicesPassword !== undefined),
    logger,
  });
  const speakers = createGuildSpeakers({
    synthesizer: createSynthesizer(catalog),
    rates: await loadProductionRates(path.join(config.dataDir, 'speech-stats.json'), logger),
    logger,
    maxQueueLength: config.maxQueueLength,
    idleTimeoutMs: config.idleTimeoutMs,
  });
  const moderation = await loadModerationStore(path.join(userVoicesDirectory(config), 'moderation.json'), logger);
  const userVoiceService = await setUpUserVoices(config, userVoices, catalog, logger, (userId) => moderation.isBanned(userId));
  const commands = createCommands(config);
  const client = createDiscordClient();
  const handleInteraction = createInteractionHandler(commands, {
    config,
    speakers,
    preferences,
    catalog,
    logger,
    userVoices: userVoiceService,
    moderation,
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info('Connected to Discord', { user: ready.user.tag, guilds: ready.guilds.cache.size });
    registerCommands(ready, commands, config.guildId, logger).catch((error: unknown) => {
      logger.error('Failed to register slash commands', { error });
    });
  });
  client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
  const autoRead = { speakers, preferences, logger, maxTextLength: config.maxTextLength };
  client.on(Events.MessageCreate, (message) => {
    handleAutoReadMessage(message, autoRead).catch((error: unknown) => {
      logger.error('Auto-read failed for a message', { error, guildId: message.guildId });
    });
  });
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
