/**
 * Settings shared by models that run in their own server container and speak
 * the OpenAI-style speech API (Phonon, NeuTTS).
 */
export interface SpeechServerSettings {
  /** Base URL of the server. */
  readonly url: string;
  /** How long a load attempt waits for the server; a first start downloads the model. */
  readonly startupTimeoutMs: number;
}

export interface SpeechServerSettingNames {
  /** e.g. PHONON_URL */
  readonly urlVariable: string;
  /** e.g. PHONON_STARTUP_TIMEOUT_SECONDS */
  readonly timeoutVariable: string;
  readonly defaultUrl: string;
  readonly defaultTimeoutSeconds: number;
}

/** Reads a server model's URL and startup timeout; throws a clear error for bad values. */
export function speechServerSettings(
  env: Readonly<Record<string, string | undefined>>,
  names: SpeechServerSettingNames,
): SpeechServerSettings {
  const rawUrl = env[names.urlVariable]?.trim() || names.defaultUrl;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${names.urlVariable} is not a valid URL (got "${rawUrl}")`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${names.urlVariable} must be http or https (got "${rawUrl}")`);
  }
  const rawTimeout = env[names.timeoutVariable]?.trim();
  const seconds = rawTimeout ? Number(rawTimeout) : names.defaultTimeoutSeconds;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    throw new Error(`${names.timeoutVariable} must be 0 to 3600 (got "${rawTimeout}")`);
  }
  return { url: url.toString().replace(/\/$/, ''), startupTimeoutMs: seconds * 1000 };
}
