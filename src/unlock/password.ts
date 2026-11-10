import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/**
 * Compares a typed password with the configured one in constant time. Both are
 * hashed first so their lengths can't leak through timing either.
 */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given.trim()), digest(expected));
}
