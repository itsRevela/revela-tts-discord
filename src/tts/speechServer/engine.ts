import type { ModelLoadOptions, TtsEngine, Voice } from '../types.ts';
import { fetchVoiceList, streamSpeech, waitForServer, type ServerVoiceList } from './client.ts';
import { speechServerSettings, type SpeechServerSettingNames } from './settings.ts';

/** A voice as the bot shows it, plus the name the server knows it by. */
export interface ServerVoice extends Voice {
  readonly serverName: string;
}

export interface SpeechServerModel {
  /** For log messages, e.g. "Phonon". */
  readonly name: string;
  readonly settings: SpeechServerSettingNames;
  /** Server voice name used when a stored voice no longer exists. */
  readonly fallbackVoice: string;
  /** Turns the server's voice list into labelled voices. */
  readonly describeVoices: (list: ServerVoiceList) => readonly ServerVoice[];
}

/**
 * Loads a model that runs in its own server container: waits for the server,
 * reads its voices, then streams speech over HTTP. Speed is left to the server.
 */
export async function loadSpeechServerModel(model: SpeechServerModel, options: ModelLoadOptions): Promise<TtsEngine> {
  const { url, startupTimeoutMs } = speechServerSettings(options.env, model.settings);
  await waitForServer(url, startupTimeoutMs, () => {
    options.logger.info(`Waiting for the ${model.name} server (a first start downloads the model)`, { url });
  });
  const described = model.describeVoices(await fetchVoiceList(url));
  const serverNames = new Map(described.map((voice) => [voice.id, voice.serverName]));
  const voices: readonly Voice[] = described.map(({ serverName: _serverName, ...voice }) => voice);
  return {
    voices,
    synthesize: ({ text, voiceId, onChunk, signal }) =>
      streamSpeech(url, { text, voice: serverNames.get(voiceId) ?? model.fallbackVoice, signal }, onChunk),
  };
}
