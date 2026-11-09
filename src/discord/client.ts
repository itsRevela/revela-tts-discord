import { Client, GatewayIntentBits } from 'discord.js';

/** Only non-privileged intents: guild info and voice states (to find the caller's channel). */
export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
}
