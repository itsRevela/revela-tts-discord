# revela-tts-discord

A self-hosted Discord text-to-speech bot. `/tts` reads your message aloud in your voice channel. Speech is generated locally on the CPU through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), and each user picks their own model and voice. Nothing is sent to an outside TTS service.

## Models

| Model | id | Voices | Notes |
|---|---|---|---|
| [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) (default) | `pocket` | Kyutai's 21 English voices, plus any custom voices | Clones a voice from a short recording. About 0.6× real time on the Ryzen 5 5500 (fp32). |
| [Gradium Phonon 40m](https://huggingface.co/gradium/phonon-40m-en) | `phonon` | Gradium's 25 English voices (American and British) plus 12 fantasy characters | Fastest by far: streams audio as it is generated. Runs in Gradium's own server, a second container. Gated model, CC BY-NC 4.0. |
| [Neuphonic NeuTTS Air](https://huggingface.co/neuphonic/neutts-air) | `neutts` | Neuphonic's 6 English sample voices (Jo, Dave, Emily, Paul, Sophie, Steven) | A 0.5B language model with the NeuCodec decoder, run through llama.cpp. Runs in this repository's Python service (`services/neutts`), a separate container. Gated model files, Apache-2.0. |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | `kokoro` | 28 English and 8 Mandarin Chinese presets, graded A to F by Kokoro's author | Clearest output and fastest, at about 0.28× real time. Reads Chinese text (汉字) as Mandarin and mixed Chinese/English messages too. |

Models are modules. Each one lives in `src/tts/models/<id>/` with its voice catalog, its settings and an engine that loads it, and each is listed once in `src/tts/modelRegistry.ts`. Pocket and Kokoro run in-process through sherpa-onnx, with their files baked into the image by the Dockerfile. Phonon (Gradium's `ptts-openai-server`) and NeuTTS (`services/neutts`, a small FastAPI server around Neuphonic's package) run in their own containers. They speak the same streaming speech API, so both use the shared client in `src/tts/speechServer/`. Server-backed models load in the background and join `/voice` once their server answers, retrying every minute. A slow first download or a missing licence acceptance therefore never delays the bot.

## Commands

| Command | What it does |
|---|---|
| `/tts text:<message>` | Joins your voice channel (if not already there) and reads the message aloud with your model and voice. If playback hasn't started within 1.5 s (slow models such as NeuTTS, or a busy queue), the reply shows a progress line that updates every 2 s ("Generating voice ▰▰▰▱▱▱▱▱▱▱ 30% · about 9 s", "In line · 2 messages ahead") and disappears when playback starts. The reply shows what was read and is deleted once the message finishes playing, is skipped, or is dropped because the bot left or disconnected (`REPLY_DELETE_AFTER_PLAYBACK`). |
| `/voice [name]` | Picks your voice from every model. Picking one switches the model for you, so there is no separate model command. With no name it opens a private picker: a filter (All voices, Phonon, Phonon Characters, NeuTTS Air, Pocket TTS, Kokoro English, Kokoro Mandarin Chinese, Custom voices: highest quality first), 25 voices per page with Previous/Next buttons, and your current voice marked. "All voices" covers the built-in voices only; custom voices have their own filter. With a name, autocomplete searches every voice by name, accent, grade, model or "custom" (e.g. "heart", "pocket", "chinese", "rekp"). |
| `/customvoice [name]` | A shortcut listing only the custom voices (also in `/voice` under "Custom voices"). NeuTTS versions are listed first, then Pocket TTS. Picking one switches you to the model that clones it. |
| `/announce [enabled]` | Turns "*Alex says,* ..." on or off for your messages. On by default. With no option it toggles. The name is only said when the speaker changes. |
| `/skip` | Stops the message being read. |
| `/leave` | Leaves the voice channel and drops queued messages. |

All settings are saved per user. `/skip` and `/leave` work for people in the bot's channel, or anyone with **Move Members**. The bot also leaves when its channel empties or after `IDLE_TIMEOUT_MINUTES` without messages.

Message text is cleaned up before it is spoken. Mentions become names, links become "a link", code blocks and spoilers are summarized, and emoji and markdown are dropped.

## Custom voices

Two models clone voices: Pocket and NeuTTS. Each custom voice appears once per model under "Custom voices" in `/voice`, for example "rekp (custom) · Pocket TTS" and "rekp (custom) · NeuTTS Air". NeuTTS versions are listed first, then Pocket ones. `/customvoice rekp` picks the version for your current model if it has one, otherwise the first listed. The file name is the voice name as written: `Tony Balogna.wav` becomes "Tony Balogna". Use clean speech from one person, without music, since both models reproduce the recording's audio quality as well as the voice. Recordings live on the server only.

**NeuTTS (automatic).** Put the original recording in `data/voices/<Name>.wav` and restart the `neutts` container. On startup it:

- trims the recording to a 6–12 s clip that ends at a pause;
- transcribes the clip with Whisper (small.en);
- encodes the clip with NeuCodec.

The results are cached in `data/voices/neutts/`: `<Name>.pt` (the encoded clip), `<Name>.txt` (the transcript) and `<Name>.ref.wav` (the trimmed clip, for listening). NeuTTS clones best when the transcript matches the clip word for word, so check `<Name>.txt` and fix it if needed. Edits are kept. Replacing the recording prepares it again. The first preparation downloads Whisper and NeuCodec's encoder, several GB, into the `neutts-cache` volume.

**Pocket (manual).** Put a cut of the recording in `data/voices/pocket/<Name>.wav` and restart the bot. The best second must be at the start (see below).

The sherpa-onnx Pocket export clones from only the **first ~1 second** of the file. Anything after that is ignored, so the file should start on clear, typical speech. For the current voices, every one-second window of the original recordings was scored with a speaker-verification model (WeSpeaker ResNet34) and the best window was moved to the start. That raised the average similarity to the real voice from about 0.68 to 0.76. Sampling temperature 0.9 also scored better than sherpa's default 0.7 (`src/tts/models/pocket/config.ts`).

Recordings are kept out of git and the image (`.gitignore` and `.dockerignore` exclude audio files), and they never leave the server. Only clone people who are fine with it.

## Discord setup

1. Create an application at <https://discord.com/developers/applications>, open **Bot**, and copy the token (**Reset Token**). No privileged intents are needed.
2. Invite the bot with this URL, replacing `CLIENT_ID` with the application id:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=3146752`
   (permissions: View Channel, Connect, Speak).

## Run on Unraid (Docker Compose)

```sh
# on the server
mkdir -p /mnt/user/appdata/revela-tts-discord/data/voices/pocket
chown -R 99:100 /mnt/user/appdata/revela-tts-discord/data
cd /mnt/user/appdata/revela-tts-discord/app   # this repository
cp .env.example .env && chmod 600 .env        # then set DISCORD_TOKEN
docker compose up -d --build
docker logs -f revela-tts-discord
```

The image downloads Pocket, Kokoro and Kyutai's voices while it builds (about 900 MB in total). On their first start, the Phonon and NeuTTS containers download their models into the `phonon-cache` and `neutts-cache` volumes. Compose builds and starts all three containers. The NeuTTS build compiles llama.cpp for the server's own CPU, which takes several minutes. `POCKET_VARIANT=int8` (a build arg) gives a smaller Pocket that runs about 35% faster. User preferences live in `/data/preferences.json`.

## Configuration

Set these in `.env`. Only `DISCORD_TOKEN` is required.

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_TOKEN` | (required) | Bot token. |
| `DISCORD_GUILD_ID` | (empty) | Register commands to one server only, which updates them instantly. Leave empty to register globally. |
| `TTS_MODELS` | `phonon,neutts,pocket,kokoro` | Models to load, in the order `/voice` lists them. Leave out `phonon` or `neutts` if you don't run their containers. |
| `HF_TOKEN` | (empty) | Hugging Face read token for the gated Phonon and NeuTTS files. Accept their terms first (see `.env.example`). Only those containers use it. |
| `PHONON_MODEL` | `hf://gradium/phonon-40m-en` | Phonon checkpoint the server loads, e.g. the ungated `hf://gradium/phonon-31m-en`. |
| `PHONON_QUANT` | `q8` | Phonon weight format on the CPU. |
| `PHONON_URL` | `http://phonon:8880` | Where the bot finds the Phonon server. |
| `PHONON_STARTUP_TIMEOUT_SECONDS` | `300` | How long one attempt waits for the Phonon server before retrying a minute later. |
| `NEUTTS_BACKBONE` | `neuphonic/neutts-air-q8-gguf` | NeuTTS backbone, e.g. the faster `neuphonic/neutts-air-q4-gguf`. |
| `NEUTTS_URL`, `NEUTTS_STARTUP_TIMEOUT_SECONDS` | `http://neutts:8880`, `300` | Like the Phonon settings. |
| `DEFAULT_MODEL` | `phonon` | Model for users who haven't picked one. Must be in `TTS_MODELS`. A server-backed default loads in the background; until it is ready, the first loaded model in `TTS_MODELS` stands in. |
| `DEFAULT_VOICE` | the model's own (Harper for Phonon) | A voice of the default model, for users who haven't picked one. For a server-backed model it is checked once the server answers, and an unknown name falls back to the model's own default. |
| `TTS_THREADS` | `4` | CPU threads for synthesis. On the Ryzen 5 5500, 4 threads is nearly as fast as 6. |
| `TTS_SPEED` | `1.0` | 0.5–2.0. |
| `MAX_TEXT_LENGTH` | `300` | Maximum characters per `/tts`. |
| `MAX_QUEUE_LENGTH` | `10` | Messages waiting per server. |
| `IDLE_TIMEOUT_MINUTES` | `15` | Leave after this long without messages. `0` never leaves. |
| `REPLY_DELETE_AFTER_PLAYBACK` | `true` | Delete each `/tts` reply once its message is done: played, skipped, or dropped when the bot leaves or disconnects. Error replies (such as a failed join) are deleted after 15 seconds. `false` keeps them. |
| `REPLY_DELETE_MINUTES` | `0` | Also delete the `/tts` reply after this long, whichever comes first. `0` turns the timer off. Up to 14 minutes the reply is deleted through the interaction; longer delays delete it through the channel, which needs View Channel there. Deletions still pending when the bot restarts are dropped, so those replies stay. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `MODELS_DIR`, `DATA_DIR` | `/models`, `/data` | Already set in the image. Models load from `MODELS_DIR/<id>`, custom voices from `DATA_DIR/voices/<id>`. |

## Development

Requires Node.js 24 or later. Node runs the TypeScript directly, so there is no build step.

```sh
npm install
npm test            # unit tests (node:test)
npm run typecheck   # tsc --noEmit
# NeuTTS server tests (Python, run in a container):
docker run --rm -v "$PWD/services/neutts:/app" -w /app python:3.12-slim \
  sh -c "pip install -q fastapi==0.162.2 httpx numpy pytest && python -m pytest -q"
npm start           # run the bot (needs DISCORD_TOKEN and the models)
```

The smoke test synthesizes with a real model, without Discord, and checks that the event loop stays free:
`docker exec revela-tts-discord node scripts/smoke-tts.ts pocket custom:rekp "Hello there"`. Arguments are model, voice id and text.

## Layout

```
src/
  main.ts                 composition root: config, models, preferences, Discord client
  config/                 environment parsing and validation
  commands/               one file per slash command, plus shared guards
  discord/                client, interaction routing, command registration, reply cleanup, voice-state watcher
  playback/               speech queue (streams each message as it is synthesized), playback buffer, message status, voice session, per-guild speakers
  loading/                the /tts progress line: rendering and the throttled reply updater
  tts/
    models/<id>/          one folder per model: voices, sherpa config, engine, definition
    modelRegistry.ts      the list of models
    loadModels.ts         loads the configured models
    modelCatalog.ts       runtime lookup of models and voices (built-in and custom)
    synthesizer.ts        routes speech to a model, one synthesis at a time
    sherpa/               shared sherpa-onnx streaming helper
  text/                   message cleanup, speakable names, "<name> says" logic
  preferences/            per-user model, voice-per-model and announce settings in a JSON file
  audio/                  24 kHz mono float to 48 kHz stereo PCM for Discord
scripts/                  smoke test, Pocket voice download (used by the image build)
tests/                    mirrors src/
documentation/research/   model selection report
```

## Notes

- **sherpa-onnx-node is pinned to 1.13.8.** Version 2.0 removed espeak-ng, so Kokoro would silently skip words missing from its lexicon (names, slang, typos). 1.13.8 falls back to espeak-ng for them. Pocket TTS is supported in 1.13.8 as well.
- **CPU only.** The server's GTX 960 (Maxwell, 2 GB) is not supported by current CUDA or ONNX Runtime builds. Measured on the Ryzen 5 5500 with 4 threads:
  - Kokoro fp32: about 0.4 s to first audio and 0.28× real time.
  - Pocket fp32: about 0.6 s to first audio and 0.6× real time.
  - Pocket int8: about 0.4 s to first audio and 0.41× real time.
  - The first use of each Pocket voice adds about 0.4 s; after that it is cached.
- **Chinese.** Only Kokoro reads Chinese. Pocket (including custom voices) is English-only: Chinese text comes out as garbled babble, so pick a Kokoro voice in `/voice` for Chinese. Kokoro's 8 Mandarin voices are all graded D by its author, and English text read by a Mandarin voice (or Chinese text read by an English voice) comes out heavily accented. In `/voice`, pick the "Kokoro Mandarin Chinese" filter or type "chinese".
- **Licences.** Kokoro is Apache-2.0. The Pocket ONNX export is for non-commercial use. Kyutai's voices are CC BY 4.0 or CC0, except `cosette` and `jean`, which are CC BY-NC 4.0. Each voice's licence is listed in `src/tts/models/pocket/voices.ts`.
