import { streamSpeech } from '../tts/speechServer/client.ts';
import { userVoiceKey } from './ids.ts';

/** What the Pocket server reports after checking and cloning an uploaded clip. */
export interface PreparedClip {
  readonly durationSec: number;
  /** Kyutai clones from the first 30 s only. */
  readonly truncated: boolean;
}

/** A refusal from the Pocket server, with its error code (e.g. "too_short"). */
export class PocketVoiceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PocketVoiceError';
    this.code = code;
  }
}

/** Pocket's error codes as messages for the uploader. */
const PROBLEMS: Readonly<Record<string, string>> = {
  too_short: 'That clip is too short. Upload at least 5 seconds of talking (the minimum is 3).',
  too_long: 'That clip is too long. Keep it under a minute; 10 to 20 seconds is ideal.',
  unsupported_audio: "That file couldn't be read as audio. Export it again as .wav, .flac, .ogg or .mp3.",
  not_found: 'The upload went missing before it could be processed. Please try again.',
  clone_failed: "The voice couldn't be cloned from that clip. Try a different recording.",
  not_ready: 'Pocket TTS is still starting up. Try again in a minute.',
};

export function problemFor(error: unknown): string {
  if (error instanceof PocketVoiceError) return PROBLEMS[error.code] ?? 'Pocket TTS refused the clip.';
  return "Pocket TTS couldn't be reached. Try again in a minute.";
}

export interface PocketVoiceClient {
  prepare(id: string): Promise<PreparedClip>;
  /** Forgets a deleted voice's clone; harmless if Pocket never cloned it. */
  forget(id: string): Promise<void>;
  /** Speaks `text` in the voice, as 24 kHz mono samples. */
  speak(id: string, text: string): Promise<Float32Array>;
}

async function failure(response: Response): Promise<PocketVoiceError> {
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  return new PocketVoiceError(body.error?.code ?? `http_${response.status}`, body.error?.message ?? response.statusText);
}

export function createPocketVoiceClient(baseUrl: string, fetchImpl: typeof fetch = fetch): PocketVoiceClient {
  const endpoint = (id: string): string => `${baseUrl}/v1/user-voices/${encodeURIComponent(id)}`;
  return {
    prepare: async (id) => {
      const response = await fetchImpl(`${endpoint(id)}/prepare`, { method: 'POST', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw await failure(response);
      const body = (await response.json()) as { durationSec?: unknown; truncated?: unknown };
      return { durationSec: Number(body.durationSec) || 0, truncated: body.truncated === true };
    },
    forget: async (id) => {
      const response = await fetchImpl(endpoint(id), { method: 'DELETE', signal: AbortSignal.timeout(30_000) });
      if (!response.ok && response.status !== 404) throw await failure(response);
    },
    speak: async (id, text) => {
      const chunks: Float32Array[] = [];
      await streamSpeech(baseUrl, { text, voice: userVoiceKey(id), signal: AbortSignal.timeout(60_000) }, (chunk) => {
        chunks.push(chunk.samples);
      });
      const samples = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      chunks.reduce((offset, chunk) => {
        samples.set(chunk, offset);
        return offset + chunk.length;
      }, 0);
      return samples;
    },
  };
}
