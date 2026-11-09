# revela-tts-discord

A self-hosted Discord text-to-speech bot. `/tts` reads your message aloud in your voice channel using [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), running locally on the CPU through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Nothing is sent to an outside TTS service.

## Commands

| Command | What it does |
|---|---|
| `/tts text:<message>` | Joins your voice channel (if not already there) and reads the message aloud. The reply shows what was read and is deleted after `REPLY_DELETE_MINUTES` (default 5). |
| `/voice [name]` | Shows your voice, or picks one of the 28 English Kokoro voices (autocomplete). Saved per user. |
| `/announce [enabled]` | Turns "*Alex says,* ..." on or off for your messages. On by default. With no option it toggles. The name is only said when the speaker changes. |
| `/skip` | Stops the message being read. |
| `/leave` | Leaves the voice channel and drops queued messages. |

`/skip` and `/leave` work for people in the bot's channel, or anyone with **Move Members**. The bot also leaves when its channel empties or after `IDLE_TIMEOUT_MINUTES` without messages.

Message text is cleaned up before it is spoken. Mentions become names, links become "a link", code blocks and spoilers are summarized, and emoji and markdown are dropped.

## Discord setup

1. Create an application at <https://discord.com/developers/applications>, open **Bot**, and copy the token (**Reset Token**). No privileged intents are needed.
2. Invite the bot with this URL, replacing `CLIENT_ID` with the application id:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=3146752`
   (permissions: View Channel, Connect, Speak).

## Run on Unraid (Docker Compose)

```sh
# on the server
mkdir -p /mnt/user/appdata/revela-tts-discord/data
chown 99:100 /mnt/user/appdata/revela-tts-discord/data
cd /mnt/user/appdata/revela-tts-discord/app   # this repository
cp .env.example .env && chmod 600 .env        # then set DISCORD_TOKEN
docker compose up -d --build
docker logs -f revela-tts-discord
```

The image downloads the Kokoro model while it builds (about 350 MB), so the container needs no internet access at runtime other than Discord. User preferences live in `/data/preferences.json`.

## Configuration

Set these in `.env`. Only `DISCORD_TOKEN` is required.

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_TOKEN` | (required) | Bot token. |
| `DISCORD_GUILD_ID` | (empty) | Register commands to one server only, which updates them instantly. Leave empty to register globally. |
| `DEFAULT_VOICE` | `af_heart` | Voice for users who haven't picked one. |
| `TTS_THREADS` | `4` | CPU threads for synthesis. On the Ryzen 5 5500, 4 threads is nearly as fast as 6. |
| `TTS_SPEED` | `1.0` | 0.5–2.0. |
| `MAX_TEXT_LENGTH` | `300` | Maximum characters per `/tts`. |
| `MAX_QUEUE_LENGTH` | `10` | Messages waiting per server. |
| `IDLE_TIMEOUT_MINUTES` | `15` | Leave after this long without messages. `0` never leaves. |
| `REPLY_DELETE_MINUTES` | `5` | Delete the `/tts` reply after this long. `0` keeps it. Up to 14 minutes the reply is deleted through the interaction; longer delays delete it through the channel, which needs View Channel there. Deletions still pending when the bot restarts are dropped, so those replies stay. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `KOKORO_MODEL_DIR`, `DATA_DIR` | `/models/kokoro`, `/data` | Already set in the image. |

## Development

Requires Node.js 24 or later. Node runs the TypeScript directly, so there is no build step.

```sh
npm install
npm test            # unit tests (node:test)
npm run typecheck   # tsc --noEmit
npm run smoke       # synthesize a sample with the real model (set KOKORO_MODEL_DIR)
npm start           # run the bot (needs DISCORD_TOKEN and the model)
```

Inside the container: `docker exec revela-tts-discord node scripts/smoke-tts.ts bm_george "Hello there"`.

## Layout

```
src/
  main.ts                 composition root: config, model, preferences, Discord client
  config/                 environment parsing and validation
  commands/               one file per slash command, plus shared guards
  discord/                client, interaction routing, command registration, voice-state watcher, mention lookup
  playback/               speech queue (synthesis runs ahead of playback), voice session, per-guild speakers
  tts/                    Kokoro engine wrapper, English voice table
  text/                   message cleanup, speakable names, "<name> says" logic
  preferences/            per-user voice and announce settings in a JSON file
  audio/                  24 kHz mono float to 48 kHz stereo PCM for Discord
scripts/smoke-tts.ts      model check without Discord
tests/                    mirrors src/
documentation/research/   model selection report
```

## Notes

- **sherpa-onnx-node is pinned to 1.13.8.** Version 2.0 removed espeak-ng, so words missing from the lexicon (names, slang, typos) would be silently skipped. 1.13.8 falls back to espeak-ng for them.
- **CPU only.** The server's GTX 960 (Maxwell, 2 GB) is not supported by current CUDA or ONNX Runtime builds, and Kokoro already runs faster than real time on the CPU. Measured on the Ryzen 5 5500 with 4 threads: about 0.4 s to first audio for a short message, and about 0.28× real time overall.
