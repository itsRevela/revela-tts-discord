import type { ModelCatalog } from '../tts/modelCatalog.ts';
import { matchKey } from './names.ts';

/**
 * Names of the bot's own voices (built-in and curated), which a community
 * voice may not take: "Alba", "Heart", "rekp" and so on, compared by match key.
 */
export function reservedVoiceNames(models: ModelCatalog): ReadonlySet<string> {
  const names = models.models.flatMap((model) =>
    model.voices
      .filter((voice) => !voice.uploaded)
      .flatMap((voice) => [voice.id.replace(/^custom:/, ''), voice.label.split(' (')[0] ?? voice.label]),
  );
  return new Set(names.map(matchKey).filter(Boolean));
}
