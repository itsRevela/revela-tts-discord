import type { SpeechServerSettingNames } from '../../speechServer/settings.ts';

/** Where the bot finds the Pocket server (services/pocket); shared by the model and the upload client. */
export const POCKET_SERVER: SpeechServerSettingNames = {
  urlVariable: 'POCKET_URL',
  timeoutVariable: 'POCKET_STARTUP_TIMEOUT_SECONDS',
  defaultUrl: 'http://pocket:8880',
  // The first start downloads the model and clones every custom voice.
  defaultTimeoutSeconds: 600,
};
