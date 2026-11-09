import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Config } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';
import type { PreferenceStore } from '../preferences/preferenceStore.ts';

/** Everything a command handler may use; passed in so handlers stay testable. */
export interface CommandContext {
  readonly config: Config;
  readonly speakers: GuildSpeakers;
  readonly preferences: PreferenceStore;
  readonly logger: Logger;
}

export interface SlashCommand {
  readonly data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
}
