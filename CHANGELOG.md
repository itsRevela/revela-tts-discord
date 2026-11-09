# Changelog

## 2026-11-09: /voice categories ordered by quality

**What:** The model registry, and with it the default `TTS_MODELS`, is now ordered `phonon,neutts,pocket,kokoro`. The `/voice` filter therefore reads: All voices, Phonon, Phonon Characters, NeuTTS Air, Pocket TTS, Kokoro English, Kokoro Mandarin Chinese, Custom voices. "All voices" and the empty-query autocomplete mix follow the same order. Custom voices keep their own order (NeuTTS, then Pocket).

**Why:** Owner request: put the higher-quality models at the top.

**Files:** `src/tts/modelRegistry.ts`, `tests/config/config.test.ts`, `tests/tts/voiceDirectory.test.ts`, `README.md`, `.env.example`.

## 2026-11-09: Phonon (Harper) is the default voice

**What:**
- `DEFAULT_MODEL` now defaults to `phonon`, and Phonon's starting voice is Harper (`PHONON_STARTING_VOICE`). If the server lacks Harper, it falls back to Phonon's own voice.
- A server-backed default model now loads in the background like the other remote models. Until it joins, the first loaded model in `TTS_MODELS` (Pocket) stands in as the default, so a slow or failed Phonon server never blocks startup. `ModelCatalog.defaultModelId` is now a getter that reflects this.
- `DEFAULT_VOICE` for a server-backed model is no longer checked against the static registry (its voices are only known at load time). An unknown name falls back at runtime.
- Existing users: the one-time migration of `data/preferences.json` to `phonon:Harper` is pending. It keeps each user's other per-model voices and announce setting.

**Why:** Owner request: Phonon (Harper) for first-time users and, after migration, for current users.

**Files:** `src/tts/models/phonon/{voices,index}.ts`, `src/config/config.ts`, `src/tts/modelCatalog.ts`, `src/main.ts`, `tests/config/config.test.ts`, `tests/tts/modelCatalog.test.ts`, `tests/preferences/catalogDefaults.test.ts`, `README.md`, `.env.example`.

## 2026-11-09: /tts progress line, NeuTTS custom voices listed first

**What:**
- If playback has not started within 1.5 s, the `/tts` reply gets a subtext progress line that refreshes every 2 s and is removed when playback starts. Lines: "Generating voice", with a bar, percent and time left, or elapsed seconds before any estimate; "In line · N messages ahead"; "Ready · plays after N messages". Fast models post the plain reply directly, so they never show it.
- Progress comes from the playback buffer's own start estimate (`estimatedWaitSeconds`). Before the first chunk it uses the model's remembered speed. The displayed percent never goes backwards and is capped at 99 % until playback.
- The speech queue reports each message's status (`queued`, `generating`, `ready`, `playing`) through a new `onStatus` callback. Edits are serialized, unchanged text is never re-sent, and an already-deleted reply is ignored.
- Under "Custom voices" (`/voice` and `/customvoice`), NeuTTS versions are listed first, then Pocket TTS. A bare `/customvoice <name>` from a model without that voice now picks the NeuTTS version.

**Why:** Owner requests: show that the bot is still generating rather than frozen, and put the NeuTTS custom voices at the top.

**Files:** `src/loading/{renderLoading,loadingReply}.ts` (new), `src/playback/{speechStatus,playbackBuffer,speechQueue,guildSpeaker}.ts`, `src/commands/tts.ts`, `src/discord/replyCleanup.ts`, `src/tts/voiceDirectory.ts`, `tests/loading/*`, `tests/playback/{speechStatus,speechQueue}.test.ts`, `tests/commands/{tts,voiceSelection}.test.ts`, `tests/tts/voiceDirectory.test.ts`, `README.md`.

## 2026-11-09: Delete /tts replies when their message is done

**What:**
- New `REPLY_DELETE_AFTER_PLAYBACK` setting, on by default. Each `/tts` reply is deleted once its message finishes playing, is skipped, fails, or is dropped because the bot left (`/leave`, idle timeout) or lost its connection.
- The speech queue calls a per-message `onDone` exactly once on every exit path. The reply cleanup handles the message finishing before the reply is posted.
- Error replies after deferring (such as a failed join) have no speech to wait for and are deleted after 15 s.
- `REPLY_DELETE_MINUTES` now defaults to `0` (off). It still works as an extra timer.
- On shutdown (restart or redeploy), the bot leaves voice, which deletes the pending replies, and then waits up to 5 s for those deletions before exiting.

**Why:** Owner request: replies should disappear when the speech ends, not after a fixed 5 minutes.

**Files:** `src/config/config.ts`, `src/discord/replyCleanup.ts`, `src/playback/{speechQueue,guildSpeaker}.ts`, `src/commands/tts.ts`, `src/main.ts`, `tests/{config/config,commands/tts,discord/replyCleanup,playback/speechQueue,playback/guildSpeakers}.test.ts`, `README.md`, `.env.example`.

## 2026-11-09: Time-based playback buffer, saved speech stats

**What:**
- The buffer now gates on time instead of buffered audio. Playback starts once elapsed time ≥ A·(1/R − 1)·1.2. R is the overall rate measured from the start of synthesis (the lower of this message's rate and the model's remembered one); A is the estimated total audio.
- Because a slower-than-real-time model never outpaces playback, starting at that point never runs dry, even with NeuTTS's pauses between pieces. A 250 ms timer rechecks during those pauses.
- Learned model speeds and voice paces are saved to `data/speech-stats.json` and loaded at startup. The file was seeded with measured NeuTTS values.

**Why:** After NeuTTS started speaking long text in pieces, the in-piece rate (0.72×) overstated the real average (about 0.56×). Playback therefore cut in and out at piece boundaries.

**Verification:** Replays of real NeuTTS timing (391 and 112 characters) showed no gaps. A unit simulation of bursty pieces also showed none.

**Files:** `src/playback/{playbackBuffer,speechQueue,guildSpeakers,rateStore}.ts`, `src/main.ts`, `tests/playback/{playbackBuffer,speechQueue,rateStore}.test.ts`.

## 2026-11-09: NeuTTS long messages and runaway guard

**What:**
- The NeuTTS server splits input into pieces of at most 120 characters at sentence boundaries (then commas, then spaces) and speaks them in order in one stream.
- A piece that produces more than 0.25 s of audio per character (minimum 4 s) is cut off, and its generator is closed so llama.cpp stops.
- Custom-voice transcripts were corrected by the owner (rekp, revela, Tony Balogna, squatch). The Whisper versions are kept as `*.txt.whisper-backup` on the server.

**Why:** NeuTTS has a 2048-token context. Reference codes, reference transcript, input and generated speech share it, so a ~800-character message stopped mid-sentence. A wrong rekp transcript made it babble for 16–25 s on an 8 s sentence. With the fixed transcript it produced 12.7–14.7 s. Lowering the temperature made babbling worse (tested 1.0, 0.7 and 0.5), so it stays at 1.0.

**Files:** `services/neutts/{text_chunks.py,server.py,Dockerfile}`, `services/neutts/tests/{test_text_chunks,test_server}.py`.

## 2026-11-09: Adaptive playback buffer

**What:** A message from a model slower than real time now waits until enough audio is buffered to play without gaps. The required head start is the estimated total audio times (1 − measured rate), plus 20%. Total audio is the text length times the voice's speaking pace: learned per voice from finished messages, or 0.13 s per character until then. The first version assumed 0.10 s and ran short on rekp, which speaks at 0.124 s per character. The bot measures each model's rate on the current message once it has two chunks, and remembers it across messages. Models faster than real time (Pocket, Kokoro, Phonon) still start on their first chunk.

**Why:** NeuTTS Air Q8 produces about 0.75 s of audio per second on this CPU, so its playback cut out after almost every word.

**Files:** `src/playback/playbackBuffer.ts` (new), `src/playback/{speechQueue,guildSpeaker,guildSpeakers}.ts`, `tests/playback/{playbackBuffer,speechQueue}.test.ts`.

## 2026-11-09: NeuTTS performance and watermark setting

**What:**
- The NeuTTS server sets llama.cpp's threads to the physical core count (`NEUTTS_THREADS`, default half the hardware threads). NeuTTS used all 12 hardware threads for prompt processing, which measured 55 tokens/s against 380 tokens/s on 6 cores.
- New `NEUTTS_WATERMARK` setting. It defaults to on; this deployment sets it to false at the owner's request.

**Measured on the Ryzen 5 5500:**
- Q8 generation is memory-bandwidth bound at about 46 tokens/s, against the 50 needed for real time, so NeuTTS Air Q8 runs at about 1.7–2.5× real time.
- Speaker similarity of the custom voices averages 0.783 on NeuTTS against 0.758 for tuned Pocket.

**Why:** These made NeuTTS usable; it is still slower than real time on Q8.

**Files:** `services/neutts/server.py`, `docker-compose.yml`.

## 2026-11-09: Custom voices on NeuTTS

**What:**
- The NeuTTS service prepares custom voices on its own: each `data/voices/<Name>.wav` is trimmed (6–12 s, ending at a pause), transcribed with Whisper small.en and encoded with NeuCodec. The results are cached in `data/voices/neutts/`; edited transcripts are kept.
- The voices endpoint lists these under a new `custom` field. The bot gives them the same `custom:<slug>` ids as Pocket's custom voices.
- Each custom voice appears once per model under "Custom voices". `/customvoice` uses model-qualified values and prefers the current model's version.
- Original recordings for all 8 voices were uploaded to the server.
- Fixes found while deploying:
  - Pinned `torchao==0.17.0`, because torchtune 0.6.1 (imported by neucodec) breaks on 0.18.
  - Made the image's home and cache folders usable by the 99:100 user.
  - Turned on Python logging.

**Why:** The user chose this setup so custom voices can use either model. NeuTTS clones from the whole clip, while Pocket uses only its first second.

**Files:**
- New: `services/neutts/{voice_prep.py,tests/test_voice_prep.py}`, `src/tts/customVoiceIds.ts`.
- Changed: `services/neutts/{server.py,Dockerfile,tests/test_server.py}`, `src/tts/speechServer/{client,engine}.ts`, `src/tts/models/{neutts,phonon}/voices.ts`, `src/tts/models/pocket/customVoices.ts`, `src/tts/modelCatalog.ts`, `src/commands/customVoice.ts`, `docker-compose.yml`, `README.md`.
- Tests: `tests/{commands/voiceSelection,tts/modelCatalog,tts/speechServer/speechServer}.test.ts`.

## 2026-11-09: NeuTTS Air model, shared speech-server client, background loading

**What:**
- Added Neuphonic NeuTTS Air (Q8 GGUF backbone plus ONNX NeuCodec decoder) as a fourth model. It runs in a new Python service, `services/neutts`: a FastAPI server around Neuphonic's package (pinned commit), with llama.cpp compiled for the host CPU and its 6 English sample voices.
- The service speaks the same streaming speech API as Phonon, so Phonon's HTTP client became the shared `src/tts/speechServer/` module.
- Server-backed models (`remote: true`) now load in the background and join `/voice` when ready, retrying every minute. To support this, the model catalog can grow at runtime.
- Fixed in review: PCM conversion now rounds instead of truncating.

**Why:** The user asked for NeuTTS Air. A second server-backed model made a shared client and non-blocking startup worthwhile.

**Files:**
- New: `services/neutts/{Dockerfile,server.py,tests/test_server.py}`, `src/tts/models/neutts/*`, `src/tts/speechServer/{client,engine,settings,pcm16}.ts` (moved from `models/phonon`), `src/tts/backgroundModels.ts`, `tests/tts/{backgroundModels,speechServer/speechServer}.test.ts`.
- Changed: `src/tts/{types,modelCatalog,modelRegistry}.ts`, `src/tts/models/phonon/{engine,index}.ts`, `src/main.ts`, `docker-compose.yml`, `.env.example`, `README.md`, `tests/tts/modelCatalog.test.ts`, `tests/config/config.test.ts`.

## 2026-11-09: Gradium Phonon 40m model

**What:**
- Added Phonon (`gradium/phonon-40m-en`, q8) as a third model. It runs in Gradium's `ptts-openai-server:0.6.0`, a second compose service reachable only on the internal network.
- The model module is a streaming HTTP client: PCM over `/v1/audio/speech`, with a busy retry and abort support.
- Voices come from the server, labelled with accent, gender and description from Gradium's voice catalog. The 12 character voices get their own "Phonon Characters" filter.
- Models can now read their own settings from the environment (`PHONON_URL`, `PHONON_STARTUP_TIMEOUT_SECONDS`).
- A model that fails to load is skipped unless it is the default model.
- The HF token for the gated model lives in the server `.env` only.

**Why:** The user asked for Phonon. Measured on the Ryzen 5 5500, it gives about 40 ms to first audio and 0.14× real time, the fastest of the three models.

**Files:**
- New: `src/tts/models/phonon/{index,engine,client,settings,voices,pcm16}.ts`, `tests/tts/models/phonon/phonon.test.ts`.
- Changed: `src/tts/{types,loadModels,voiceDirectory,modelRegistry}.ts`, `src/commands/voicePicker.ts`, `src/main.ts`, `scripts/smoke-tts.ts`, `docker-compose.yml`, `.env.example`, `README.md`, `tests/tts/loadModels.test.ts`, `tests/config/config.test.ts`.

## 2026-11-09: Custom voices as a /voice category

**What:**
- The `/voice` picker has a "Custom voices" filter, and "All voices" now covers only the built-in voices.
- Typing in `/voice` also finds custom voices, and picking one switches to Pocket TTS.
- In labels, custom voices are marked "(custom)".
- `/customvoice` stays as a shortcut.

**Why:** The user asked for custom voices to be a category of their own, kept out of "All voices".

**Files:** `src/tts/voiceDirectory.ts`, `src/commands/{voice,voicePicker}.ts`, `tests/tts/voiceDirectory.test.ts`, `tests/commands/{voicePicker,voiceSelection}.test.ts`, `README.md`.

## 2026-11-09: One voice list across models, with a paged picker

**What:**
- `/voice` now lists the built-in voices of every model (Pocket, Kokoro English, Kokoro Mandarin), and picking one switches the model, so `/model` is removed.
- `/voice` with no name opens a private picker: a filter menu, 25 voices per page, and Previous/Next buttons. The picker stores its state in its custom ids, so the server keeps nothing between clicks.
- Autocomplete searches every model; with nothing typed it shows a mix of every group.
- Custom voices stay in `/customvoice`, as the user asked.

**Why:** The user asked for one voice list and for pagination; Discord autocomplete caps suggestions at 25 with no scrolling.

**Files:**
- New: `src/tts/voiceDirectory.ts`, `src/commands/voicePicker.ts`, `tests/tts/voiceDirectory.test.ts`, `tests/commands/voicePicker.test.ts`.
- Changed: `src/commands/{voice,index,types}.ts`, `src/discord/interactionRouter.ts`, `src/tts/modelCatalog.ts`, `src/main.ts`, `tests/commands/voiceSelection.test.ts`, `tests/discord/interactionRouter.test.ts`, `tests/tts/modelCatalog.test.ts`, `tests/helpers/fakes.ts`, `README.md`.
- Removed: `src/commands/model.ts`.

## 2026-11-09: Mandarin Chinese voices

**What:** Kokoro now loads its Chinese lexicon, jieba dictionary and date/phone/number rules, so Chinese text is read as Mandarin. It also gains its 8 Mandarin voices (zf_xiaobei to zm_yunyang, speakers 45–52, all grade D) in `/voice`. The redundant `lang: en-us` setting is gone: the model's metadata already sets en-us, and English output is unchanged.

**Why:** The user asked for Chinese voices. Before this change, Chinese characters were silently dropped: a 12-character sentence produced 0.28 s of silence.

**Files:** `src/tts/models/kokoro/{voices,config,index}.ts`, `src/types/sherpa-onnx-node.d.ts`, `Dockerfile`, `tests/tts/models/kokoro/{voices,config}.test.ts`, `README.md`.

## 2026-11-09: Custom voice quality tuning

**What:** Pocket now samples at temperature 0.9 instead of sherpa's default 0.7. Each custom voice recording on the server was re-cut so that it starts at its best-scoring one-second window, and "squatch" was added.

**Why:** Testing showed that the sherpa-onnx Pocket export only reads about the first 1.04 s of a reference recording; 2 s and 22 s clips give identical output. Speaker-verification scoring (WeSpeaker ResNet34 cosine against each person's full recording) measured these averages:
- Temperature: 0.648 at 0.3, 0.681 at 0.7, 0.704 at 0.9.
- 10 diffusion steps: no gain over 5, and about 12% slower.
- Best window per voice: average about 0.68 → 0.76 (MoistCr1tikal 0.72 → 0.85).

**Files:** `src/tts/models/pocket/config.ts`, `src/tts/models/pocket/engine.ts`, `README.md`. The voice recordings changed on the server only.

## 2026-11-09: Pocket TTS, per-user models, custom voices

**What:**
- Models are now modules: `src/tts/models/<id>/` holds each model's voices, config and engine, and `modelRegistry.ts` lists them.
- Added Kyutai Pocket TTS (fp32, with Kyutai's 21 English voices) and made it the default model.
- New `/model` command; `/voice` now lists the built-in voices of your current model.
- New `/customvoice` command for voices cloned from recordings in `data/voices/pocket/` on the server.
- Preferences now store a model and a voice per model. People who had picked a Kokoro voice stay on Kokoro.
- Each message plays as one continuous stream, since Pocket returns several chunks per sentence.
- New config: `TTS_MODELS`, `DEFAULT_MODEL`, and `MODELS_DIR` (replaces `KOKORO_MODEL_DIR`).
- Audio files are now git- and docker-ignored.

**Why:** The user asked for per-user model selection, Pocket TTS, modular models and custom cloned voices. On the server, Pocket benchmarked at 0.57–0.63× real time (fp32) and 0.41× (int8), so it can run as the default on the CPU.

**Files:**
- New: `src/tts/models/{kokoro,pocket}/*`, `src/tts/{modelRegistry,modelCatalog,loadModels,synthesizer}.ts`, `src/tts/sherpa/streamGeneration.ts`, `src/preferences/catalogDefaults.ts`, `src/commands/{model,customVoice,describeVoice}.ts`, `scripts/fetch-pocket-voices.ts`.
- Changed: `src/tts/types.ts`, `src/types/sherpa-onnx-node.d.ts`, `src/config/config.ts`, `src/preferences/{userPreferences,preferenceStore}.ts`, `src/playback/{speechQueue,voiceSession,guildSpeaker,guildSpeakers}.ts`, `src/commands/{tts,voice,index,types}.ts`, `src/main.ts`, `scripts/smoke-tts.ts`, `Dockerfile`, `.gitignore`, `.dockerignore`, `.env.example`, `README.md`.
- Tests: `tests/**`; `src/tts/voices.ts` and `kokoroEngine.ts` moved into `src/tts/models/kokoro/`.

## 2026-11-09: Voice grades in /voice

**What:** Every voice now carries Kokoro's published quality grade (A to F+). `/voice` autocomplete shows the grade on each option and lists voices best first, and you can search by grade (e.g. "grade a").

**Why:** Voice quality varies widely (af_heart is A, am_adam is F+), so people should be able to see that when choosing.

**Files:** `src/tts/voices.ts`, `tests/tts/voices.test.ts`, `tests/commands/preferences.test.ts`, `README.md`.

## 2026-11-09: Auto-delete /tts replies

**What:** Public `/tts` replies, including the "queue full" and "couldn't join" notices, are deleted after `REPLY_DELETE_MINUTES` (default 5; 0 keeps them). Delays up to 14 minutes delete through the interaction token, which needs no channel permissions. Longer delays delete the message through the channel.

**Why:** Keep text channels from filling up with TTS transcripts.

**Files:** `src/discord/replyCleanup.ts` (new), `src/commands/tts.ts`, `src/config/config.ts`, `tests/discord/replyCleanup.test.ts` (new), `tests/commands/tts.test.ts`, `tests/config/config.test.ts`, `tests/helpers/fakes.ts`, `README.md`, `.env.example`.

## 2026-11-09: Initial bot

**What:** Discord TTS bot with `/tts`, `/voice`, `/announce`, `/skip` and `/leave`. Kokoro-82M (fp32) runs on the CPU via sherpa-onnx-node 1.13.8, and synthesis streams sentence by sentence so playback starts after the first sentence. Each user has a saved voice and an "announce my name" setting (on by default; the name is spoken only when the speaker changes). The bot ships as a Docker image with the model baked in, plus a compose file for Unraid.

**Why:** A self-hosted, low-latency TTS bot for the Unraid server (Ryzen 5 5500). Kokoro was chosen over kitten-tts-2 and Breeze TTS 2, which need large GPUs. See `documentation/research/2026-11-09-tts-model-selection.md`. A benchmark on the server showed fp32 is about 2× faster than int8 on this CPU, and that 4 threads is near the best. sherpa-onnx 2.x dropped espeak-ng, so 1.13.8 is pinned to keep pronunciation of out-of-lexicon words.

**Files:** `src/**` (config, commands, discord, playback, tts, text, preferences, audio, logging, util), `tests/**`, `scripts/smoke-tts.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `documentation/tests/unit-test-checklist-2026-11-09-005445.md`.
