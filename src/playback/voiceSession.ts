import { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import type { Logger } from '../logging/logger.ts';
import type { ClipPlayer } from './speechQueue.ts';

const READY_TIMEOUT_MS = 20_000;
const RECONNECT_GRACE_MS = 5_000;

/** A live voice connection in one guild plus the player that speaks into it. */
export interface VoiceSession {
  readonly guildId: string;
  /** Current channel; follows the bot if someone moves it. */
  readonly channelId: string;
  readonly player: ClipPlayer;
  destroy(): void;
}

export interface OpenVoiceSessionOptions {
  readonly channel: VoiceBasedChannel;
  /** Called once when the connection is gone for good. */
  readonly onClosed: () => void;
  readonly logger: Logger;
}

export type OpenVoiceSession = (options: OpenVoiceSessionOptions) => Promise<VoiceSession>;

function createClipPlayer(player: AudioPlayer, logger: Logger): ClipPlayer {
  return {
    play: (pcm) =>
      new Promise<void>((resolve) => {
        const finish = (): void => {
          player.off(AudioPlayerStatus.Idle, finish);
          player.off('error', onError);
          resolve();
        };
        const onError = (error: Error): void => {
          logger.warn('Audio player error', { error });
          finish();
        };
        player.on(AudioPlayerStatus.Idle, finish);
        player.on('error', onError);
        player.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw }));
      }),
    stop: () => {
      player.stop(true);
    },
  };
}

/** Follows the discord.js guide: wait briefly for a reconnect, otherwise give up. */
function handleDisconnects(connection: VoiceConnection, logger: Logger): void {
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_GRACE_MS),
      entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_GRACE_MS),
    ]).catch(() => {
      logger.info('Voice connection lost', { guildId: connection.joinConfig.guildId });
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    });
  });
}

export const openVoiceSession: OpenVoiceSession = async ({ channel, onClosed, logger }) => {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });
  const audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.on('error', (error) => logger.warn('Voice connection error', { error, guildId: channel.guild.id }));
  connection.once(VoiceConnectionStatus.Destroyed, () => {
    audioPlayer.stop(true);
    onClosed();
  });
  handleDisconnects(connection, logger);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
  } catch (error: unknown) {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    throw new Error(`Timed out joining voice channel ${channel.id}`, { cause: error });
  }
  connection.subscribe(audioPlayer);

  return {
    guildId: channel.guild.id,
    get channelId() {
      return connection.joinConfig.channelId ?? channel.id;
    },
    player: createClipPlayer(audioPlayer, logger),
    destroy: () => {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    },
  };
};
