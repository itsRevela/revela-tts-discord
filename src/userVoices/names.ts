export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 32;

/** Letters (any script), digits, spaces, apostrophes and hyphens: nothing Discord renders as markdown or a mention. */
const ALLOWED = /^[\p{L}\p{N} '-]+$/u;
const HAS_LETTER = /\p{L}/u;

export type NameCheck = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problem: string };

/** Tidies a typed voice name and checks it against the naming rules. */
export function checkVoiceName(raw: string): NameCheck {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN_LENGTH || name.length > NAME_MAX_LENGTH) {
    return { ok: false, problem: `Voice names are ${NAME_MIN_LENGTH} to ${NAME_MAX_LENGTH} characters long.` };
  }
  if (!ALLOWED.test(name)) return { ok: false, problem: "Use only letters, numbers, spaces, ' and - in voice names." };
  if (!HAS_LETTER.test(name)) return { ok: false, problem: 'Voice names need at least one letter.' };
  return { ok: true, name };
}

/** Look-alike letters from other scripts that are commonly used to dodge filters. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', ı: 'i', ⅼ: 'l', ο: 'o', α: 'a', ε: 'e', ι: 'i', κ: 'k',
  ν: 'v', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
};
const LEETSPEAK: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', $: 's', '!': 'i', '|': 'l' };

/**
 * The form names are compared in: case, accents, look-alike letters and
 * leetspeak folded, everything but letters and digits dropped. "Dr. Ünicode"
 * and "DR UNIC0DE" share a key. Used for name collisions and the blacklist.
 */
export function matchKey(text: string): string {
  return Array.from(text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase())
    .map((character) => CONFUSABLES[character] ?? LEETSPEAK[character] ?? character)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/** Each word's match key, for whole-word blacklist terms. */
export function wordKeys(text: string): readonly string[] {
  return text.split(/\s+/).map(matchKey).filter(Boolean);
}
