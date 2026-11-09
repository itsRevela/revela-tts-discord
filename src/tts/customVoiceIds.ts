/** Custom (cloned) voices share ids across models: "Tony Balogna" -> "custom:tony_balogna". */
export const CUSTOM_VOICE_PREFIX = 'custom:';

/** Case- and punctuation-insensitive id; undefined when the name has no letters or digits. */
export function customVoiceId(name: string): string | undefined {
  const slug = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  return slug ? `${CUSTOM_VOICE_PREFIX}${slug}` : undefined;
}
