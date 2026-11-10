import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Enough of the start of a file to recognise its format. */
const HEAD_BYTES = 16;

export class ClipDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipDownloadError';
  }
}

export interface DownloadedClip {
  readonly bytes: number;
  readonly head: Uint8Array;
}

/**
 * Saves an attachment to `destination`, stopping at `maxBytes` (the size
 * Discord reported is not trusted) and after a timeout. Discord's attachment
 * links expire, so this runs as soon as the upload arrives. A failed download
 * leaves no file behind.
 */
export async function downloadClip(
  url: string,
  destination: string,
  maxBytes: number,
  options: { readonly timeoutMs?: number; readonly fetch?: typeof fetch } = {},
): Promise<DownloadedClip> {
  const fetchImpl = options.fetch ?? fetch;
  let bytes = 0;
  let head = new Uint8Array(0);
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok || !response.body) throw new ClipDownloadError(`Discord returned ${response.status} for the upload.`);
    const capped = async function* (source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > maxBytes) throw new ClipDownloadError('The file is larger than allowed.');
        if (head.length < HEAD_BYTES) head = Uint8Array.from([...head, ...chunk.subarray(0, HEAD_BYTES - head.length)]);
        yield chunk;
      }
    };
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), capped, createWriteStream(destination));
    return { bytes, head };
  } catch (error: unknown) {
    await rm(destination, { force: true });
    if (error instanceof ClipDownloadError) throw error;
    throw new ClipDownloadError('The upload could not be downloaded from Discord.');
  }
}
