# Unit test checklist — 2026-11-09 00:54:45

**Project:** revela-tts-discord · **Command:** `npm test` (plus `npm run typecheck`) · **Totals:** 101 passed / 0 failed / 0 skipped

Typecheck (`tsc --noEmit`, TypeScript 7.0.2): clean.

## Results by test file
| Test file | Status | Notes |
|---|---|---|
| tests/audio/pcm.test.ts | pass | 6 tests: resampling to 48 kHz stereo, interpolation, clamping, invalid rates |
| tests/commands/controls.test.ts | pass | 6 tests: `/skip` and `/leave` permissions (same channel or Move Members) |
| tests/commands/preferences.test.ts | pass | 6 tests: `/announce` toggles (default on), `/voice` show/set/reject, autocomplete |
| tests/commands/tts.test.ts | pass | 10 tests: join and speak, announce preference, not in voice, busy elsewhere, queue full, missing Speak, empty text, join failure, server-only |
| tests/config/config.test.ts | pass | 5 tests: defaults, required token, overrides, all problems reported at once, blank values |
| tests/discord/interactionRouter.test.ts | pass | 5 tests: dispatch, ephemeral error reply, deferred error edit, unknown command, autocomplete |
| tests/discord/mentionResolver.test.ts | pass | 3 tests: id dedupe, uncached member fetch, 1.5 s lookup deadline (this test takes ~1.5 s) |
| tests/discord/voiceStateWatcher.test.ts | pass | 4 tests: leave when the channel empties, stay while people remain, cleanup when kicked |
| tests/playback/guildSpeakers.test.ts | pass | 5 tests: single join under concurrency, "<name> says" only on speaker change, full queue, disconnect/close cleanup, idle leave |
| tests/playback/idleTimer.test.ts | pass | 4 tests: fires, waits while busy, touch/cancel, disabled at 0 |
| tests/playback/speechQueue.test.ts | pass | 7 tests: ordering, playback before synthesis completes, max length, skip cancels synthesis, error recovery, close |
| tests/preferences/preferenceStore.test.ts | pass | 5 tests: defaults, persistence across reloads, corrupt-file backup, unwritable directory, concurrent updates |
| tests/preferences/userPreferences.test.ts | pass | 6 tests: overlay on defaults, retired voice, immutable merge, per-entry validation |
| tests/text/sanitize.test.ts | pass | 9 tests: mentions, links, code, spoilers, timestamps, emoji, markdown, repeats, line breaks, NFKC |
| tests/text/speakableName.test.ts | pass | 5 tests |
| tests/text/utterance.test.ts | pass | 5 tests |
| tests/tts/kokoroEngine.test.ts | pass | 2 tests: model paths, espeak-ng fallback, threads, one sentence per chunk |
| tests/tts/voices.test.ts | pass | 6 tests: 28 voices, sherpa-onnx speaker ids, labels, search |
| tests/util/serialize.test.ts | pass | 2 tests |

## Integration checks (Unraid host, inside the built image, running as 99:100)
| Check | Result |
|---|---|
| `node scripts/smoke-tts.ts` (af_heart, 2 sentences) | pass: model load 1.5 s, first chunk at 987 ms, 4.31 s of audio in 1.51 s (RTF 0.35), max event-loop delay 21.9 ms |
| `node scripts/smoke-tts.ts bm_george "<names/slang text>"` | pass: first chunk at 430 ms, 6.49 s of audio in 2.07 s (RTF 0.32), max event-loop delay 19.6 ms. Chunks are per sentence, not cumulative |
| `@discordjs/voice` dependency report | `@discordjs/opus` 0.11.0, native aes-256-gcm, `@snazzah/davey` 0.1.12 (DAVE) |
| Start without a token | exits 1 with "DISCORD_TOKEN is required" (as designed) |
| `docker compose up -d` with the real token | connected as Sqeaker#9521, registered 5 global commands, running with 0 restarts |

## Failures
| Test | Error details | Remediation |
|---|---|---|
| none | | |

## Follow-ups
- Not unit-tested: `src/playback/voiceSession.ts` (the thin `@discordjs/voice` adapter), `src/discord/registerCommands.ts`, `src/discord/client.ts` and `src/main.ts`. They are covered by the live start-up above; voice playback still needs a live `/tts` in a server.
- Pronunciation of out-of-lexicon words (names, slang) via the espeak-ng fallback produced audio, but nobody has listened to it yet.
