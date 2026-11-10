"""HTTP server for Kyutai's Pocket TTS (the official pocket-tts package), speaking
the part of the OpenAI speech API the bot uses (the same shape as Phonon and NeuTTS):

  GET  /health            {"status": "ok"} once the model is loaded
  GET  /v1/audio/voices   {"voices": [...], "custom": [...], "aliases": {}}
  POST /v1/audio/speech   {"input", "voice", "response_format": "pcm"}
                          -> headerless 16-bit mono PCM at 24 kHz, streamed

Kyutai's library prepares the text (capitalization, punctuation, padding of
short inputs), splits it into chunks of at most 50 tokens and bounds each
chunk's length, so none of that is repeated here. One generation runs at a
time; closing the response stops it.

Custom voices: every <Name>.wav in POCKET_CUSTOM_SOURCES_DIR is cloned once and
cached as a voice state, re-cloned when the recording changes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import queue
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from voices import Voice, discover_voices, voice_names

LANGUAGE = os.environ.get("POCKET_LANGUAGE", "english")
# Unset means Kyutai's recommended temperature for the model (0.3 for english_2026-10).
TEMPERATURE = float(os.environ["POCKET_TEMPERATURE"]) if os.environ.get("POCKET_TEMPERATURE") else None
# Unset means a fresh random seed for every message, as in Kyutai's tools.
SEED = int(os.environ["POCKET_SEED"]) if os.environ.get("POCKET_SEED") else None
THREADS = int(os.environ.get("POCKET_THREADS", "0")) or max((os.cpu_count() or 2) // 2, 1)
DEFAULT_VOICE = os.environ.get("POCKET_DEFAULT_VOICE", "alba").lower()
MAX_CHARS = 4096
QUEUED_CHUNKS = 8
POLL_SECONDS = 0.2

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("pocket-server")


class SpeechEngine(Protocol):
    def prepare(self, voice: Voice) -> None:
        """Makes sure the voice can be used (downloads or clones it ahead of time)."""

    def stream(self, voice: Voice, text: str, stop: threading.Event) -> Iterator[np.ndarray]:
        """Yields float audio chunks in [-1, 1] at 24 kHz until done or `stop` is set."""


@dataclass
class ServerState:
    engine: SpeechEngine | None = None
    voices: dict[str, Voice] = field(default_factory=dict)


state = ServerState()
generation_lock = asyncio.Lock()


def load_engine() -> SpeechEngine:
    from engine import KyutaiEngine  # deferred: pulls in torch and the model

    return KyutaiEngine(language=LANGUAGE, temperature=TEMPERATURE, seed=SEED, threads=THREADS)


def prepare_voices(engine: SpeechEngine, voices: dict[str, Voice]) -> dict[str, Voice]:
    """Prepares every voice up front; a voice that fails is left out rather than failing startup."""
    ready: dict[str, Voice] = {}
    for key, voice in voices.items():
        try:
            engine.prepare(voice)
            ready[key] = voice
        except Exception:  # noqa: BLE001 - one bad recording must not take the others down
            log.exception("could not prepare voice %s; leaving it out", voice.name)
    return ready


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("loading Pocket TTS (%s) on %d threads", LANGUAGE, THREADS)
    engine = await asyncio.to_thread(load_engine)
    voices = await asyncio.to_thread(prepare_voices, engine, discover_voices())
    if DEFAULT_VOICE not in voices:
        raise RuntimeError(f"default voice {DEFAULT_VOICE!r} is not among {sorted(voices)}")
    state.engine, state.voices = engine, voices
    builtin, custom = voice_names(voices)
    log.info("ready with %d voices; custom: %s", len(builtin) - 1, ", ".join(custom) or "none")
    yield


app = FastAPI(lifespan=lifespan)


def error(status: int, message: str, code: str | None = None) -> JSONResponse:
    body = {"error": {"message": message, "type": "invalid_request_error", "param": None, "code": code}}
    return JSONResponse(body, status_code=status)


def to_pcm16(wav: np.ndarray) -> bytes:
    return np.rint(np.clip(wav, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/audio/voices")
async def list_voices() -> dict[str, Any]:
    builtin, custom = voice_names(state.voices)
    return {"voices": builtin, "custom": custom, "aliases": {}}


def _produce(chunks: queue.Queue[bytes], stop: threading.Event, stream: Iterator[np.ndarray]) -> None:
    """Moves audio from the blocking generator into the queue until done or stopped."""
    try:
        for wav in stream:
            pcm = to_pcm16(wav)
            while not stop.is_set():
                try:
                    chunks.put(pcm, timeout=POLL_SECONDS)
                    break
                except queue.Full:
                    continue
            if stop.is_set():
                return
    except Exception:  # noqa: BLE001 - the response has started; log and end it
        log.exception("generation failed")


async def generate(engine: SpeechEngine, text: str, voice: Voice) -> AsyncIterator[bytes]:
    """Runs the blocking stream in a thread and relays chunks as they arrive."""
    async with generation_lock:
        chunks: queue.Queue[bytes] = queue.Queue(maxsize=QUEUED_CHUNKS)
        stop = threading.Event()
        stream = engine.stream(voice, text, stop)
        worker = threading.Thread(target=_produce, args=(chunks, stop, stream), daemon=True)
        worker.start()
        try:
            while True:
                try:
                    yield await asyncio.to_thread(chunks.get, True, POLL_SECONDS)
                except queue.Empty:
                    if not worker.is_alive() and chunks.empty():
                        break
        finally:
            stop.set()  # also tells Kyutai's generator to stop producing frames
            await asyncio.to_thread(worker.join)


@app.post("/v1/audio/speech", response_model=None)
async def speech(request: Request) -> JSONResponse | StreamingResponse:
    try:
        body = await request.json()
    except ValueError:
        return error(400, "the body must be JSON")
    if not isinstance(body, dict):
        return error(400, "the body must be a JSON object")
    text = body.get("input")
    if not isinstance(text, str) or not text.strip():
        return error(400, "input must be non-empty text", "invalid_input")
    if len(text) > MAX_CHARS:
        return error(400, f"input is longer than {MAX_CHARS} characters", "input_too_long")
    if body.get("response_format", "pcm") != "pcm":
        return error(400, "only response_format pcm is supported", "unsupported_format")
    if state.engine is None:
        return error(503, "the model is still loading", "not_ready")
    requested = str(body.get("voice") or "default").lower()
    voice = state.voices.get(DEFAULT_VOICE if requested == "default" else requested)
    if voice is None:
        return error(400, f"unknown voice {requested!r}", "unknown_voice")
    return StreamingResponse(generate(state.engine, text.strip(), voice), media_type="application/octet-stream")
