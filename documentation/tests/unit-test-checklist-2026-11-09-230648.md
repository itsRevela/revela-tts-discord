# Unit test checklist — 2026-11-09 23:06:48

**Project:** revela-tts-discord · **Command:** `npm test` (+ `npm run typecheck`, Pocket pytest, live upload check) · **Totals:** 319 passed / 0 failed / 0 skipped (Node); 26 passed / 0 failed (Pocket pytest)

Closing run for the Community Voices feature: uploaded voices, `/myvoices`, `/search`, `/communityvoices`, `/reportvoice`, `/voicemod`, and the Pocket user-voice endpoints. Typecheck: `tsc --noEmit` clean (0 errors).

## Results by test file
| Test file | Status | Notes |
|---|---|---|
| `tests/audio/pcm.test.ts` | pass | 6 passed |
| `tests/autoRead/autoReadMessages.test.ts` | pass | 5 passed |
| `tests/autoRead/reactionProgress.test.ts` | pass | 3 passed |
| `tests/commands/announce.test.ts` | pass | 2 passed |
| `tests/commands/autoRead.test.ts` | pass | 6 passed |
| `tests/commands/controls.test.ts` | pass | 6 passed |
| `tests/commands/myVoices.test.ts` | pass | 12 passed |
| `tests/commands/tts.test.ts` | pass | 15 passed |
| `tests/commands/unlock.test.ts` | pass | 7 passed |
| `tests/commands/voiceModeration.test.ts` | pass | 7 passed |
| `tests/commands/voicePicker.test.ts` | pass | 8 passed |
| `tests/commands/voiceSelection.test.ts` | pass | 17 passed |
| `tests/config/config.test.ts` | pass | 9 passed |
| `tests/discord/interactionRouter.test.ts` | pass | 7 passed |
| `tests/discord/mentionResolver.test.ts` | pass | 3 passed |
| `tests/discord/owners.test.ts` | pass | 3 passed |
| `tests/discord/replyCleanup.test.ts` | pass | 8 passed |
| `tests/discord/voiceStateWatcher.test.ts` | pass | 5 passed |
| `tests/loading/loadingReply.test.ts` | pass | 5 passed |
| `tests/loading/renderLoading.test.ts` | pass | 5 passed |
| `tests/playback/guildSpeakers.test.ts` | pass | 6 passed |
| `tests/playback/idleTimer.test.ts` | pass | 4 passed |
| `tests/playback/playbackBuffer.test.ts` | pass | 11 passed |
| `tests/playback/rateStore.test.ts` | pass | 2 passed |
| `tests/playback/speechQueue.test.ts` | pass | 14 passed |
| `tests/playback/speechStatus.test.ts` | pass | 4 passed |
| `tests/preferences/catalogDefaults.test.ts` | pass | 5 passed |
| `tests/preferences/preferenceStore.test.ts` | pass | 5 passed |
| `tests/preferences/userPreferences.test.ts` | pass | 10 passed |
| `tests/text/sanitize.test.ts` | pass | 9 passed |
| `tests/text/speakableName.test.ts` | pass | 5 passed |
| `tests/text/truncate.test.ts` | pass | 3 passed |
| `tests/text/utterance.test.ts` | pass | 5 passed |
| `tests/tts/backgroundModels.test.ts` | pass | 2 passed |
| `tests/tts/loadModels.test.ts` | pass | 2 passed |
| `tests/tts/modelCatalog.test.ts` | pass | 4 passed |
| `tests/tts/models/kokoro/config.test.ts` | pass | 2 passed |
| `tests/tts/models/kokoro/voices.test.ts` | pass | 7 passed |
| `tests/tts/models/pocket/voices.test.ts` | pass | 3 passed |
| `tests/tts/speechServer/speechServer.test.ts` | pass | 12 passed |
| `tests/tts/synthesizer.test.ts` | pass | 2 passed |
| `tests/tts/voiceDirectory.test.ts` | pass | 13 passed |
| `tests/unlock/unlock.test.ts` | pass | 4 passed |
| `tests/userVoices/catalog.test.ts` | pass | 7 passed |
| `tests/userVoices/catalogVoices.test.ts` | pass | 8 passed |
| `tests/userVoices/names.test.ts` | pass | 8 passed |
| `tests/userVoices/pipeline.test.ts` | pass | 9 passed |
| `tests/userVoices/service.test.ts` | pass | 12 passed |
| `tests/util/serialize.test.ts` | pass | 2 passed |
| `services/pocket/tests/test_server.py`, `test_voices.py`, `test_user_voices.py` | pass | 26 passed (pytest in python:3.12-slim on the server) |
| Live end-to-end upload (`bench/e2e-upload.mts` in the bot image against the deployed Pocket server) | pass | 24-bit `drum.wav` (13.1 s): add → clone → preview → delete in 2.95 s; preview 3.6 s of audio; source folder and Pocket clone removed |

## Failures
| Test | Error details | Remediation |
|---|---|---|
| none | | |

Problems found and fixed during the build (not failures in this run):
- Pocket test id used a `9`, which is outside base32; fixed in the test and in the plan's example id.
- The Pocket image copied its modules by name and missed `user_voices.py`, so it crash-looped for about two minutes; the Dockerfile now copies `*.py`.
- Tests expected raw usernames after markdown escaping was added; updated to expect `alex\_user`.

## Follow-ups
- Manual checks in Discord: the upload form on desktop and mobile, the attachment fallback, the progress line, preview playback, publish/unpublish seen from a second account, delete while another user has the voice selected, and a takedown DM.
- `data/name-blacklist.txt` has no terms yet; the owner fills it in.
- Optional `/review-pipeline` for an independent review of the upload and moderation code.
