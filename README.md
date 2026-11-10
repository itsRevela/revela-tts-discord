# revela-tts-discord

A self-hosted Discord text-to-speech bot. `/tts` reads your message aloud in your voice channel. Speech is generated locally on the CPU through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), and each user picks their own model and voice. Nothing is sent to an outside TTS service.

## Models

| Model | id | Voices | Notes |
|---|---|---|---|
| [Gradium Phonon 40m](https://huggingface.co/gradium/phonon-40m-en) (default, voice Harper) | `phonon` | Gradium's 25 English voices (American and British) plus 12 fantasy characters | Fastest by far: streams audio as it is generated. Runs in Gradium's own server, a second container. Gated model, CC BY-NC 4.0. |
| [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) | `pocket` | Kyutai's 21 English voices, plus any custom voices | Kyutai's own `pocket-tts` runtime and its newest English model (`english_2026-10`), in this repository's Python service (`services/pocket`). Clones a voice from a recording. About 0.33× real time on the Ryzen 5 5500 (three times faster than playback). Voice cloning needs the gated `kyutai/pocket-tts` weights. |
| [Neuphonic NeuTTS Air](https://huggingface.co/neuphonic/neutts-air) | `neutts` | Neuphonic's 6 English sample voices (Jo, Dave, Emily, Paul, Sophie, Steven) | A 0.5B language model with the NeuCodec decoder, run through llama.cpp. Runs in this repository's Python service (`services/neutts`), a separate container. Gated model files, Apache-2.0. |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | `kokoro` | 28 English and 8 Mandarin Chinese presets, graded A to F by Kokoro's author | Clearest output and fastest, at about 0.28× real time. Reads Chinese text (汉字) as Mandarin and mixed Chinese/English messages too. |

Models are modules. Each one lives in `src/tts/models/<id>/` with its voice catalog, its settings and an engine that loads it, and each is listed once in `src/tts/modelRegistry.ts`. Kokoro runs in-process through sherpa-onnx, with its files baked into the image by the Dockerfile. Phonon (Gradium's `ptts-openai-server`), Pocket (`services/pocket`, a small FastAPI server around Kyutai's `pocket-tts`) and NeuTTS (`services/neutts`, the same around Neuphonic's package) run in their own containers. They speak the same streaming speech API, so all three use the shared client in `src/tts/speechServer/`. Server-backed models load in the background and join `/voice` once their server answers, retrying every minute. A slow first download or a missing licence acceptance therefore never delays the bot.

## Commands

| Command | What it does |
|---|---|
| `/tts text:<message>` | Joins your voice channel (if not already there) and reads the message aloud with your model and voice. If playback hasn't started within 1.5 s (slow models such as NeuTTS, or a busy queue), the reply shows a progress line that updates every 2 s ("Generating voice ▰▰▰▱▱▱▱▱▱▱ 30% · about 9 s", "In line · 2 messages ahead") and disappears when playback starts. The reply shows what was read and is deleted once the message finishes playing, is skipped, or is dropped because the bot left or disconnected (`REPLY_DELETE_AFTER_PLAYBACK`). |
| `/voice [name]` | Picks your voice from every model. Picking one switches the model for you, so there is no separate model command. With no name it opens a private picker: a filter (All voices, Phonon, Phonon Characters, Pocket TTS, NeuTTS Air, Kokoro English, Kokoro Mandarin Chinese, Custom voices: highest quality first), 25 voices per page with Previous/Next buttons, and your current voice marked. "All voices" covers the built-in voices only; custom voices have their own filter. With a name, autocomplete searches every voice by name, accent, grade, model or "custom" (e.g. "heart", "pocket", "chinese", "rekp"). |
| `/customvoice [name]` | A shortcut listing only the custom voices (also in `/voice` under "Custom voices"). Pocket TTS versions are listed first, then NeuTTS. Picking one switches you to the model that clones it. |
| `/unlock password:<password>` | Unlocks the custom voices for you when `CUSTOM_VOICES_PASSWORD` is set. The reply is private and the password is never logged. After 5 wrong tries, you wait 15 minutes. Until you unlock, custom voices are hidden from `/voice` and `/customvoice`, and a custom voice you picked earlier falls back to that model's default. |
| `/announce [enabled]` | Turns "*Alex says,* ..." on or off for your messages. On by default. With no option it toggles. The name is only said when the speaker changes. |
| `/autoread add [channel]` · `remove [channel]` · `list` · `off` | Reads your ordinary messages in chosen channels aloud, as if you had used `/tts`, without deleting them. Choose up to 10 channels per server: text channels, announcement channels, or a voice channel's chat. The channel defaults to the one you use the command in. If speech takes over 1.5 s to start, ⏳ appears on your message until playback begins. Messages sent while you're not in a voice channel, or while the bot is busy in another channel, are skipped quietly. Other people keep using `/tts`. |
| `/skip` | Stops the message being read. |
| `/leave` | Leaves the voice channel and drops queued messages. |

All settings are saved per user. Speech only plays for people in the bot's voice channel: if someone leaves or moves away, their queued messages are dropped and the one playing stops. `/skip` and `/leave` work for people in the bot's channel, or anyone with **Move Members**. The bot also leaves when its channel empties or after `IDLE_TIMEOUT_MINUTES` without messages.

Message text is cleaned up before it is spoken. Mentions become names, links become "a link", code blocks and spoilers are summarized, and emoji and markdown are dropped.

## Custom voices

Two models clone voices: Pocket and NeuTTS. Each custom voice appears once per model under "Custom voices" in `/voice`, for example "rekp (custom) · Pocket TTS" and "rekp (custom) · NeuTTS Air". Pocket versions are listed first, then NeuTTS ones. `/customvoice rekp` picks the version for your current model if it has one, otherwise the first listed. The file name is the voice name as written: `Tony Balogna.wav` becomes "Tony Balogna". Use clean speech from one person, without music, since both models reproduce the recording's audio quality as well as the voice. Recordings live on the server only.

**NeuTTS (automatic).** Put the original recording in `data/voices/<Name>.wav` and restart the `neutts` container. On startup it:

- trims the recording to a 6–12 s clip that ends at a pause;
- transcribes the clip with Whisper (small.en);
- encodes the clip with NeuCodec.

The results are cached in `data/voices/neutts/`: `<Name>.pt` (the encoded clip), `<Name>.txt` (the transcript) and `<Name>.ref.wav` (the trimmed clip, for listening). NeuTTS clones best when the transcript matches the clip word for word, so check `<Name>.txt` and fix it if needed. Edits are kept. Replacing the recording prepares it again. The first preparation downloads Whisper and NeuCodec's encoder, several GB, into the `neutts-cache` volume.

**Pocket (automatic).** Uses the same original recordings in `data/voices/<Name>.wav`; restart the `pocket` container after adding one. On startup it clones each new or changed recording once (Kyutai reads up to 30 s of it, ending at a pause) and caches the result in the `pocket-cache` volume, so later starts are quick.

Recordings are kept out of git and the image (`.gitignore` and `.dockerignore` exclude audio files), and they never leave the server. Only clone people who are fine with it.

## Discord setup

1. Create an application at <https://discord.com/developers/applications>, open **Bot**, and copy the token (**Reset Token**). Under **Privileged Gateway Intents**, turn on **Message Content Intent**; `/autoread` needs it, and the bot fails to log in without it ("disallowed intents").
2. Invite the bot with this URL, replacing `CLIENT_ID` with the application id:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=3212352`
   (permissions: View Channel, Connect, Speak, plus Add Reactions and Read Message History for the `/autoread` progress reaction; servers usually allow these two by default).

## Run on Unraid (Docker Compose)

```sh
# on the server
mkdir -p /mnt/user/appdata/revela-tts-discord/data/voices
chown -R 99:100 /mnt/user/appdata/revela-tts-discord/data
cd /mnt/user/appdata/revela-tts-discord/app   # this repository
cp .env.example .env && chmod 600 .env        # then set DISCORD_TOKEN
docker compose up -d --build
docker logs -f revela-tts-discord
```

The bot image downloads Kokoro while it builds. On their first start, the Phonon, Pocket and NeuTTS containers download their models into the `phonon-cache`, `pocket-cache` and `neutts-cache` volumes. Compose builds and starts all four containers. The NeuTTS build compiles llama.cpp for the server's own CPU, which takes several minutes. User preferences live in `/data/preferences.json`.

## Configuration

Set these in `.env`. Only `DISCORD_TOKEN` is required.

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_TOKEN` | (required) | Bot token. |
| `DISCORD_GUILD_ID` | (empty) | Register commands to one server only, which updates them instantly. Leave empty to register globally. |
| `TTS_MODELS` | `phonon,pocket,neutts,kokoro` | Models to load, in the order `/voice` lists them. Leave out `phonon` or `neutts` if you don't run their containers. |
| `HF_TOKEN` | (empty) | Hugging Face read token for the gated Phonon and NeuTTS files. Accept their terms first (see `.env.example`). Only those containers use it. |
| `PHONON_MODEL` | `hf://gradium/phonon-40m-en` | Phonon checkpoint the server loads, e.g. the ungated `hf://gradium/phonon-31m-en`. |
| `PHONON_QUANT` | `q8` | Phonon weight format on the CPU. |
| `PHONON_URL` | `http://phonon:8880` | Where the bot finds the Phonon server. |
| `PHONON_STARTUP_TIMEOUT_SECONDS` | `300` | How long one attempt waits for the Phonon server before retrying a minute later. |
| `NEUTTS_BACKBONE` | `neuphonic/neutts-air-q8-gguf` | NeuTTS backbone, e.g. the faster `neuphonic/neutts-air-q4-gguf`. |
| `POCKET_URL`, `POCKET_STARTUP_TIMEOUT_SECONDS` | `http://pocket:8880`, `600` | Like the Phonon settings. |
| `POCKET_TEMPERATURE`, `POCKET_SEED` | Kyutai's 0.3, random | Pocket sampling (set on the `pocket` container). A fixed seed makes the same text sound the same every time. |
| `NEUTTS_URL`, `NEUTTS_STARTUP_TIMEOUT_SECONDS` | `http://neutts:8880`, `300` | Like the Phonon settings. |
| `DEFAULT_MODEL` | `phonon` | Model for users who haven't picked one. Must be in `TTS_MODELS`. A server-backed default loads in the background; until it is ready, the first loaded model in `TTS_MODELS` stands in. |
| `DEFAULT_VOICE` | the model's own (Harper for Phonon) | A voice of the default model, for users who haven't picked one. For a server-backed model it is checked once the server answers, and an unknown name falls back to the model's own default. |
| `TTS_THREADS` | `4` | CPU threads for synthesis. On the Ryzen 5 5500, 4 threads is nearly as fast as 6. |
| `TTS_SPEED` | `1.0` | 0.5–2.0. |
| `MAX_TEXT_LENGTH` | `300` | Maximum characters per `/tts`. |
| `MAX_QUEUE_LENGTH` | `10` | Messages waiting per server. |
| `IDLE_TIMEOUT_MINUTES` | `15` | Leave after this long without messages. `0` never leaves. |
| `CUSTOM_VOICES_PASSWORD` | unset | When set, custom voices need `/unlock` with this password; each user unlocks once. Unset means custom voices are open to everyone. Keep it in the server's `.env` only, single-quoted if it contains `$`. |
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
# Pocket and NeuTTS server tests (Python, run in a container; swap neutts for pocket):
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
  speech/                 shared by /tts and auto-read: preflight checks and speaking for a member
  autoRead/               /autoread message handling and the progress reaction
  unlock/                 /unlock password check (constant time) and wrong-attempt limiter
  playback/               speech queue (streams each message as it is synthesized), playback buffer, message status, voice session, per-guild speakers
  loading/                the /tts progress line: rendering and the throttled reply updater
  tts/
    models/<id>/          one folder per model: voices, settings, engine, definition
    modelRegistry.ts      the list of models
    loadModels.ts         loads the configured models
    modelCatalog.ts       runtime lookup of models and voices (built-in and custom)
    synthesizer.ts        routes speech to a model, one synthesis at a time
    sherpa/               shared sherpa-onnx streaming helper
  text/                   message cleanup, speakable names, "<name> says" logic
  preferences/            per-user model, voice-per-model and announce settings in a JSON file
  audio/                  24 kHz mono float to 48 kHz stereo PCM for Discord
scripts/                  smoke test
services/pocket/          Kyutai pocket-tts server (FastAPI), with pytest tests
services/neutts/          NeuTTS server (FastAPI), with pytest tests
tests/                    mirrors src/
documentation/research/   model selection report
```

## Notes

- **sherpa-onnx-node is pinned to 1.13.8.** Version 2.0 removed espeak-ng, so Kokoro would silently skip words missing from its lexicon (names, slang, typos). 1.13.8 falls back to espeak-ng for them. Only Kokoro runs on sherpa-onnx now.
- **CPU only.** The server's GTX 960 (Maxwell, 2 GB) is not supported by current CUDA or ONNX Runtime builds. Measured on the Ryzen 5 5500 with 4 threads:
  - Kokoro fp32: about 0.4 s to first audio and 0.28× real time.
  - Pocket (Kyutai pocket-tts, PyTorch): about 0.33× real time. It replaced the sherpa-onnx Pocket export, whose January model clipped first words, ran away on short text and hallucinated (see `documentation/research/2026-11-09-pocket-tts-settings.md`).
- **Chinese.** Only Kokoro reads Chinese. Pocket (including custom voices) is English-only: Chinese text comes out as garbled babble, so pick a Kokoro voice in `/voice` for Chinese. Kokoro's 8 Mandarin voices are all graded D by its author, and English text read by a Mandarin voice (or Chinese text read by an English voice) comes out heavily accented. In `/voice`, pick the "Kokoro Mandarin Chinese" filter or type "chinese".
- **Licences.** Kokoro is Apache-2.0. Pocket's voice-cloning weights are gated on Hugging Face under Kyutai's terms. Kyutai's voices are CC BY 4.0 or CC0, except `cosette` and `jean`, which are CC BY-NC 4.0. Each voice's licence is listed in `src/tts/models/pocket/voices.ts`.
