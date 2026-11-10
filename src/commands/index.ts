import type { Config } from '../config/config.ts';
import { announceCommand } from './announce.ts';
import { communityVoicesCommand } from './communityVoices.ts';
import { myVoicesCommand } from './myVoices/index.ts';
import { createReportVoiceCommand } from './reportVoice.ts';
import { voiceModCommand } from './voiceMod.ts';
import { searchCommand } from './search.ts';
import { autoReadCommand } from './autoRead.ts';
import { customVoiceCommand } from './customVoice.ts';
import { leaveCommand } from './leave.ts';
import { skipCommand } from './skip.ts';
import { createTtsCommand } from './tts.ts';
import { createUnlockCommand } from './unlock.ts';
import type { SlashCommand } from './types.ts';
import { voiceCommand } from './voice.ts';

/** /model was folded into /voice: picking a voice now switches the model. */
export function createCommands(config: Config): ReadonlyMap<string, SlashCommand> {
  const commands = [
    createTtsCommand(config.maxTextLength),
    voiceCommand,
    searchCommand,
    communityVoicesCommand,
    myVoicesCommand,
    createReportVoiceCommand(),
    voiceModCommand,
    customVoiceCommand,
    createUnlockCommand(),
    announceCommand,
    autoReadCommand,
    skipCommand,
    leaveCommand,
  ];
  return new Map(commands.map((command) => [command.data.name, command]));
}
