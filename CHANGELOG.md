# Changelog

## 2026-11-09: Auto-delete /tts replies

**What:** Public `/tts` replies, including the "queue full" and "couldn't join" notices, are deleted after `REPLY_DELETE_MINUTES` (default 5; 0 keeps them). Delays up to 14 minutes delete through the interaction token, which needs no channel permissions. Longer delays delete the message through the channel.

**Why:** Keep text channels from filling up with TTS transcripts.

**Files:** `src/discord/replyCleanup.ts` (new), `src/commands/tts.ts`, `src/config/config.ts`, `tests/discord/replyCleanup.test.ts` (new), `tests/commands/tts.test.ts`, `tests/config/config.test.ts`, `tests/helpers/fakes.ts`, `README.md`, `.env.example`.

## 2026-11-09: Initial bot

**What:** Discord TTS bot with `/tts`, `/voice`, `/announce`, `/skip` and `/leave`. Kokoro-82M (fp32) runs on the CPU via sherpa-onnx-node 1.13.8, and synthesis streams sentence by sentence so playback starts after the first sentence. Each user has a saved voice and an "announce my name" setting (on by default; the name is spoken only when the speaker changes). The bot ships as a Docker image with the model baked in, plus a compose file for Unraid.

**Why:** A self-hosted, low-latency TTS bot for the Unraid server (Ryzen 5 5500). Kokoro was chosen over kitten-tts-2 and Breeze TTS 2, which need large GPUs. See `documentation/research/2026-11-09-tts-model-selection.md`. A benchmark on the server showed fp32 is about 2× faster than int8 on this CPU, and that 4 threads is near the best. sherpa-onnx 2.x dropped espeak-ng, so 1.13.8 is pinned to keep pronunciation of out-of-lexicon words.

**Files:** `src/**` (config, commands, discord, playback, tts, text, preferences, audio, logging, util), `tests/**`, `scripts/smoke-tts.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `documentation/tests/unit-test-checklist-2026-11-09-005445.md`.
