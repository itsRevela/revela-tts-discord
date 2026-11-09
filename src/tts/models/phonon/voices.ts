/**
 * Metadata for Gradium's English Phonon voices, from the voices.jsonl of
 * https://huggingface.co/gradium/phonon-voices (Apache-2.0). The server
 * reports voices by name only; this adds accent, gender and a description.
 * Voices the server offers that are not listed here still work, under their name.
 */
import type { ServerVoiceList } from '../../speechServer/client.ts';
import type { ServerVoice } from '../../speechServer/engine.ts';
import type { Voice } from '../../types.ts';

/** The checkpoint's own voice, always offered by the server. */
export const PHONON_DEFAULT_VOICE = 'default';
/** The voice Phonon users get until they pick one (falls back to the default voice if the server lacks it). */
export const PHONON_STARTING_VOICE = 'Harper';
const CHARACTERS = 'Characters';

type Locale = 'American' | 'British';

interface CatalogEntry {
  readonly name: string;
  readonly locale?: Locale;
  readonly gender?: 'female' | 'male';
  readonly description: string;
}

const CATALOG: readonly CatalogEntry[] = [
  { name: 'Zoey', locale: 'American', gender: 'female', description: 'Playful, upbeat Gen Z energy' },
  { name: 'Juniper', locale: 'American', gender: 'female', description: 'Cheerful, personable, real resonance' },
  { name: 'Everly', locale: 'American', gender: 'female', description: 'Rounded, soft-edged and relaxed' },
  { name: 'Harper', locale: 'American', gender: 'female', description: 'Modern, confident and friendly' },
  { name: 'Hadley', locale: 'American', gender: 'female', description: 'Settled, even-toned and kind' },
  { name: 'Delia', locale: 'American', gender: 'female', description: 'Low, grounded and to the point' },
  { name: 'Easton', locale: 'American', gender: 'male', description: 'Punchy and close in, crisp consonants' },
  { name: 'Micah', locale: 'American', gender: 'male', description: 'Buoyant, high energy, playful' },
  { name: 'Trevor', locale: 'American', gender: 'male', description: 'Buoyant energy over a resonant core' },
  { name: 'Russell', locale: 'American', gender: 'male', description: 'High-energy and encouraging' },
  { name: 'Preston', locale: 'American', gender: 'male', description: 'Trim, focused, clean delivery' },
  { name: 'Miles', locale: 'American', gender: 'male', description: 'Resonant and decisive, wide range' },
  { name: 'Maeve', locale: 'British', gender: 'female', description: 'Sparky and attentive' },
  { name: 'Freya', locale: 'British', gender: 'female', description: 'Young, glossy and confident' },
  { name: 'Pippa', locale: 'British', gender: 'female', description: 'Confident and upbeat' },
  { name: 'Elodie-Rose', locale: 'British', gender: 'female', description: 'Young, sharp and enthusiastic' },
  { name: 'Imogen', locale: 'British', gender: 'female', description: 'Bubbly and friendly' },
  { name: 'Lottie', locale: 'British', gender: 'female', description: 'Sparky, high forward energy' },
  { name: 'Bryony', locale: 'British', gender: 'female', description: 'Full, rich and relaxed' },
  { name: 'Alfie', locale: 'British', gender: 'male', description: 'Punchy and forward' },
  { name: 'Hugh', locale: 'British', gender: 'male', description: 'Soft, airy and lively' },
  { name: 'Edwin', locale: 'British', gender: 'male', description: 'Efficient, firm and sincere' },
  { name: 'Spencer', locale: 'British', gender: 'male', description: 'Light, airy, a touch higher' },
  { name: 'Toby', locale: 'British', gender: 'male', description: 'Sparky and attentive' },
  { name: 'Teddy', locale: 'British', gender: 'male', description: 'Sparky, quick off the mark' },
  { name: 'Captain Silas Blackwater', description: 'Old West Country pirate captain' },
  { name: 'Morwenna of the Deep', description: 'Low, husky, sultry alto' },
  { name: 'Old Mortlake', description: 'Elderly Victorian gravedigger, low and raspy' },
  { name: 'Azgorath', description: 'Ancient demon, cavernous bass' },
  { name: 'Fennick the Young Elf', description: 'Curious, kind-hearted elf boy' },
  { name: 'The Thing Under the Stairs', description: 'Gravelly, breathy monster' },
  { name: 'Vyrmathrax the Ancient', description: 'Ancient dragon, very low and resonant' },
  { name: 'Grub the Ogre', description: 'Big, gruff, good-natured ogre' },
  { name: 'Master Aldric', description: 'Wise old British wizard' },
  { name: 'The Snow Queen', description: 'Regal, cold, crystalline' },
  { name: 'Sir Bramwell', description: 'Brave but pompous knight' },
  { name: 'Fairy Godmother', description: 'Kind, warm older fairy' },
];

const BY_NAME: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((entry) => [entry.name.toLowerCase(), entry]));

function toVoice(name: string): Voice {
  if (name === PHONON_DEFAULT_VOICE) {
    return { id: name, label: "Phonon's default", language: 'en', description: "The model's own voice" };
  }
  const entry = BY_NAME.get(name.toLowerCase());
  if (!entry) return { id: name, label: name, language: 'en' };
  if (!entry.locale) return { id: name, label: name, language: 'en', category: CHARACTERS, description: entry.description };
  return { id: name, label: `${name} (${entry.locale} ${entry.gender})`, language: 'en', description: entry.description };
}

function rank(name: string): number {
  if (name === PHONON_DEFAULT_VOICE) return -1;
  const index = CATALOG.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
  return index === -1 ? CATALOG.length : index;
}

/** Turns the server's voice names into voices: default first, then catalog order, then unknown names alphabetically. */
export function phononVoices(list: ServerVoiceList): readonly ServerVoice[] {
  const sorted = [...new Set(list.voices)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return sorted.map((name) => ({ ...toVoice(name), serverName: name }));
}
