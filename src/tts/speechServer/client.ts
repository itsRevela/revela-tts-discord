import { setTimeout as sleep } from 'node:timers/promises';
import type { SpeechChunk } from '../types.ts';
import { SPEECH_SERVER_SAMPLE_RATE, createPcm16Decoder } from './pcm16.ts';

const HEALTH_POLL_MS = 2_000;
const BUSY_RETRIES = 3;
const BUSY_RETRY_MS = 500;

interface ErrorBody {
  readonly error?: { readonly message?: string; readonly code?: string };
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody;
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_POLL_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Polls /health until the server answers; it downloads its model on first start. */
export async function waitForServer(baseUrl: string, timeoutMs: number, onWaiting: () => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (!(await isHealthy(baseUrl))) {
    if (Date.now() >= deadline) throw new Error(`Speech server at ${baseUrl} did not become ready in ${timeoutMs / 1000} s`);
    if (!announced) {
      onWaiting();
      announced = true;
    }
    await sleep(HEALTH_POLL_MS);
  }
}

/** What a speech server offers: built-in voices, and (as an extension) custom ones. */
export interface ServerVoiceList {
  readonly voices: readonly string[];
  readonly custom: readonly string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export async function fetchVoiceList(baseUrl: string): Promise<ServerVoiceList> {
  const response = await fetch(`${baseUrl}/v1/audio/voices`);
  if (!response.ok) throw new Error(`Listing voices at ${baseUrl} failed: ${await describeFailure(response)}`);
  const body = (await response.json()) as { voices?: unknown; custom?: unknown };
  if (!isStringArray(body.voices) || (body.custom !== undefined && !isStringArray(body.custom))) {
    throw new Error(`Speech server at ${baseUrl} returned an unexpected voice list`);
  }
  return { voices: body.voices, custom: body.custom ?? [] };
}

async function requestSpeech(baseUrl: string, text: string, voice: string, signal: AbortSignal | undefined): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, response_format: 'pcm' }),
      signal: signal ?? null,
    });
    // Another client may hold the server's only slot; wait briefly rather than fail.
    if (response.status === 429 && attempt < BUSY_RETRIES) {
      await response.body?.cancel();
      await sleep(BUSY_RETRY_MS, undefined, { signal: signal ?? undefined });
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Speech request to ${baseUrl} failed: ${await describeFailure(response)}`);
    return response;
  }
}

/**
 * Streams speech from the server, passing audio on as it arrives. Aborting
 * closes the response, which makes the server stop generating.
 */
export async function streamSpeech(
  baseUrl: string,
  request: { readonly text: string; readonly voice: string; readonly signal?: AbortSignal | undefined },
  onChunk: (chunk: SpeechChunk) => void,
): Promise<void> {
  const { text, voice, signal } = request;
  if (signal?.aborted) return;
  let response: Response;
  try {
    response = await requestSpeech(baseUrl, text, voice, signal);
  } catch (error: unknown) {
    if (signal?.aborted) return;
    throw error;
  }
  const decode = createPcm16Decoder();
  try {
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      const samples = decode(bytes);
      if (samples.length > 0) onChunk({ samples, sampleRate: SPEECH_SERVER_SAMPLE_RATE });
    }
  } catch (error: unknown) {
    if (signal?.aborted) return;
    throw error;
  }
}
