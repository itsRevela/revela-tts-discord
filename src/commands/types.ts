import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Config } from '../config/config.ts';
import type { Logger } from '../logging/logger.ts';
import type { GuildSpeakers } from '../playback/guildSpeakers.ts';
import type { PreferenceStore } from '../preferences/preferenceStore.ts';
import type { ModelCatalog } from '../tts/modelCatalog.ts';
import type { ModerationStore } from '../userVoices/moderation.ts';
import type { UserVoiceService } from '../userVoices/service.ts';

/** Everything a command handler may use; passed in so handlers stay testable. */
export interface CommandContext {
  readonly config: Config;
  readonly speakers: GuildSpeakers;
  readonly preferences: PreferenceStore;
  /** The loaded models and their voices. */
  readonly catalog: ModelCatalog;
  readonly logger: Logger;
  /** Voices users upload (/myvoices) and share (/communityvoices). */
  readonly userVoices: UserVoiceService;
  /** Upload bans and reports of community voices. */
  readonly moderation: ModerationStore;
}

export interface SlashCommand {
  readonly data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction, context: CommandContext): Promise<void>;
  /** Buttons and menus whose custom id starts with "<command name>:". */
  component?(interaction: MessageComponentInteraction, context: CommandContext): Promise<void>;
  /** Submitted pop-up forms whose custom id starts with "<command name>:". */
  modal?(interaction: ModalSubmitInteraction, context: CommandContext): Promise<void>;
}
