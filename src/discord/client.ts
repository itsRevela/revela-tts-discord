import { Client, GatewayIntentBits } from 'discord.js';

/**
 * Guild info, voice states (to find the caller's channel) and guild messages
 * for /autoread. Message Content is privileged: it must be switched on for the
 * bot in the Discord Developer Portal, or login fails with "disallowed intents".
 */
export const CLIENT_INTENTS: readonly GatewayIntentBits[] = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];

export function createDiscordClient(): Client {
  return new Client({ intents: [...CLIENT_INTENTS] });
}
