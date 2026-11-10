import type { AudioExtension } from './catalog.ts';

/** What Discord tells us about an uploaded file, before downloading it. */
export interface ClipCandidate {
  readonly name: string;
  readonly size: number;
  readonly contentType: string | null;
  readonly url: string;
}

/** File extensions accepted for uploads, and the format each is stored as. */
const EXTENSIONS: Readonly<Record<string, AudioExtension>> = {
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'ogg',
  mp3: 'mp3',
};

export const SUPPORTED_FORMATS = '.ogg, .mp3, .wav or .flac';

export type ClipCheck = { readonly ok: true; readonly ext: AudioExtension } | { readonly ok: false; readonly problem: string };

export function extensionOf(fileName: string): AudioExtension | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? EXTENSIONS[match[1]!.toLowerCase()] : undefined;
}

const megabytes = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Checks the file's name and size before anything is downloaded. */
export function checkClip(candidate: ClipCandidate, maxBytes: number): ClipCheck {
  const ext = extensionOf(candidate.name);
  if (!ext) return { ok: false, problem: `That file type isn't supported. Upload ${SUPPORTED_FORMATS}.` };
  if (candidate.size > maxBytes) return { ok: false, problem: `That file is over ${megabytes(maxBytes)}. Trim it or export a smaller file.` };
  if (candidate.size <= 0) return { ok: false, problem: 'That file is empty.' };
  return { ok: true, ext };
}

/** The audio format a file's first bytes show, whatever its name claims. */
export function sniffFormat(head: Uint8Array): AudioExtension | undefined {
  const text = (start: number, length: number): string => String.fromCharCode(...head.subarray(start, start + length));
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return 'wav';
  if (text(0, 4) === 'fLaC') return 'flac';
  if (text(0, 4) === 'OggS') return 'ogg';
  if (text(0, 3) === 'ID3') return 'mp3';
  // An MPEG audio frame starts with 11 set bits.
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) return 'mp3';
  return undefined;
}
