import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Config } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';
import type { PreferenceStore } from '../preferences/preferenceStore.ts';
import type { ModelCatalog } from '../tts/modelCatalog.ts';

/** Everything a command handler may use; passed in so handlers stay testable. */
export interface CommandContext {
  readonly config: Config;
  readonly speakers: GuildSpeakers;
  readonly preferences: PreferenceStore;
  /** The loaded models and their voices. */
  readonly catalog: ModelCatalog;
  readonly logger: Logger;
}

export interface SlashCommand {
  readonly data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
  /** Buttons and menus whose custom id starts with "<command name>:". */
  component?(interaction: MessageComponentInteraction, context: CommandContext): Promise<void>;
}
