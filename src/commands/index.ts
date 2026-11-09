import type { Config } from '../config/config.ts';
import { announceCommand } from './announce.ts';
import { leaveCommand } from './leave.ts';
import { skipCommand } from './skip.ts';
import { createTtsCommand } from './tts.ts';
import type { SlashCommand } from './types.ts';
import { voiceCommand } from './voice.ts';

export function createCommands(config: Config): ReadonlyMap<string, SlashCommand> {
  const commands = [createTtsCommand(config.maxTextLength), voiceCommand, announceCommand, skipCommand, leaveCommand];
  return new Map(commands.map((command) => [command.data.name, command]));
}
