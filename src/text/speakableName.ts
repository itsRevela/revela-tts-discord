export const MAX_NAME_LENGTH = 32;

/**
 * Reduces a Discord display name to letters, digits, spaces, apostrophes and
 * hyphens so the voice can pronounce it. NFKC folds decorative Unicode
 * lettering back to plain letters. Returns undefined when nothing is left.
 */
export function speakableName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[_.]+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : undefined;
}
