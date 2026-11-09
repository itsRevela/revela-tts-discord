"""HTTP server for Neuphonic's NeuTTS, speaking the part of the OpenAI speech API
the bot uses (the same shape as Gradium's ptts-openai-server):

  GET  /health            {"status": "ok"} once the model is loaded
  GET  /v1/audio/voices   {"voices": [...], "custom": [...], "aliases": {}}
  POST /v1/audio/speech   {"input", "voice", "response_format": "pcm"}
                          -> headerless 16-bit mono PCM at 24 kHz, streamed

One generation runs at a time; others wait. Closing the response stops generation.

Custom voices: every <Name>.wav in CUSTOM_SOURCES_DIR is prepared once into a
NeuTTS reference in CUSTOM_DIR (see voice_prep.py) and listed under "custom".
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import queue
import threading
from collections.abc import AsyncIterator, Iterable, Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from text_chunks import split_text

BACKBONE = os.environ.get("NEUTTS_BACKBONE", "neuphonic/neutts-air-q8-gguf")
CODEC = os.environ.get("NEUTTS_CODEC", "neuphonic/neucodec-onnx-decoder")
VOICES_DIR = Path(os.environ.get("NEUTTS_VOICES_DIR", "/opt/neutts/voices"))
CUSTOM_SOURCES_DIR = Path(os.environ.get("NEUTTS_CUSTOM_SOURCES_DIR", "/voices"))
CUSTOM_DIR = Path(os.environ.get("NEUTTS_CUSTOM_DIR", "/voices/neutts"))
DEFAULT_VOICE = os.environ.get("NEUTTS_DEFAULT_VOICE", "jo").lower()
# NeuTTS marks its output with Resemble's Perth watermark; NEUTTS_WATERMARK=false turns it off.
WATERMARK = os.environ.get("NEUTTS_WATERMARK", "true").strip().lower() not in ("0", "false", "no", "off")
# llama.cpp threads. NeuTTS uses every hardware thread for prompt processing;
# on a 6-core/12-thread Ryzen that measured 55 tokens/s versus 380 tokens/s on
# the 6 physical cores, so default to half the hardware threads.
THREADS = int(os.environ.get("NEUTTS_THREADS", "0")) or max((os.cpu_count() or 2) // 2, 1)
MAX_CHARS = 4096
QUEUED_CHUNKS = 8
POLL_SECONDS = 0.2
SAMPLE_RATE = 24_000
# Runaway guard: a piece that produces more audio than this has lost its place
# in the text (babbling or repeating) and is cut off.
MAX_SECONDS_PER_CHAR = 0.25
MIN_PIECE_SECONDS = 4.0

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("neutts-server")


class SpeechEngine(Protocol):
    def infer_stream(self, text: str, ref_codes: Any, ref_text: str) -> Iterable[np.ndarray]: ...


@dataclass(frozen=True)
class Voice:
    """A pre-encoded NeuCodec reference (<name>.pt) and its transcript (<name>.txt)."""

    codes: Any
    transcript: str
    name: str = ""
    custom: bool = False


@dataclass
class ServerState:
    engine: SpeechEngine | None = None
    voices: dict[str, Voice] | None = None


def voice_names(voices: dict[str, Voice]) -> tuple[list[str], list[str]]:
    """Built-in names (sorted, plus "default") and custom display names (sorted)."""
    builtin = sorted(key for key, voice in voices.items() if not voice.custom)
    custom = sorted((voice.name for voice in voices.values() if voice.custom), key=str.lower)
    return [*builtin, "default"], custom


state = ServerState()
generation_lock = asyncio.Lock()


def load_voices(directory: Path, custom: bool = False, sources: Path | None = None) -> dict[str, Voice]:
    """Loads <name>.pt + <name>.txt pairs. Custom voices are only offered while
    their source recording still exists."""
    import torch  # deferred: only the real server needs it

    voices: dict[str, Voice] = {}
    for codes_file in sorted(directory.glob("*.pt")) if directory.is_dir() else []:
        name = codes_file.stem
        transcript = codes_file.with_suffix(".txt")
        if not transcript.exists():
            log.warning("skipping voice %s: no transcript", name)
            continue
        if sources is not None and not (sources / f"{name}.wav").exists():
            continue
        codes = torch.load(codes_file, map_location="cpu", weights_only=True)
        voices[name.lower()] = Voice(codes, transcript.read_text(encoding="utf-8").strip(), name, custom)
    return voices


def load_all_voices() -> dict[str, Voice]:
    """Prepares new custom recordings, then loads built-in and custom voices.
    A custom voice whose name matches a built-in one is shadowed by it."""
    from voice_prep import prepare_custom_voices

    prepared = prepare_custom_voices(CUSTOM_SOURCES_DIR, CUSTOM_DIR)
    if prepared:
        log.info("prepared custom voices: %s", ", ".join(prepared))
    gc.collect()
    custom = load_voices(CUSTOM_DIR, custom=True, sources=CUSTOM_SOURCES_DIR)
    return {**custom, **load_voices(VOICES_DIR)}


def set_backbone_threads(engine: Any, threads: int) -> None:
    """NeuTTS does not expose llama.cpp's thread counts; set them on the live context."""
    backbone = getattr(engine, "backbone", None)
    context = getattr(getattr(backbone, "_ctx", None), "ctx", None)
    if context is None:
        log.warning("could not set llama.cpp threads: no GGUF backbone context")
        return
    import llama_cpp

    llama_cpp.llama_set_n_threads(context, threads, threads)
    log.info("llama.cpp threads: %d for generation and prompt processing", threads)


def load_engine() -> SpeechEngine:
    from neutts import NeuTTS  # deferred: pulls in torch and llama.cpp

    engine = NeuTTS(backbone_repo=BACKBONE, backbone_device="cpu", codec_repo=CODEC, codec_device="cpu")
    set_backbone_threads(engine, THREADS)
    if not WATERMARK:
        engine.watermarker = None
        log.info("Perth watermarking is off (NEUTTS_WATERMARK=false)")
    return engine


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    log.info("loading %s with codec %s", BACKBONE, CODEC)
    state.engine = await asyncio.to_thread(load_engine)
    state.voices = await asyncio.to_thread(load_all_voices)
    if DEFAULT_VOICE not in state.voices:
        raise RuntimeError(f"default voice {DEFAULT_VOICE!r} is not among {sorted(state.voices)}")
    builtin, custom = voice_names(state.voices)
    log.info("ready with voices %s; custom: %s", ", ".join(builtin), ", ".join(custom) or "none")
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
    builtin, custom = voice_names(state.voices or {})
    return {"voices": builtin, "custom": custom, "aliases": {}}


def speak_pieces(engine: SpeechEngine, text: str, voice: Voice) -> Iterator[np.ndarray]:
    """Speaks long text piece by piece so each generation fits NeuTTS's context,
    cutting off any piece that runs far longer than its text could need."""
    for piece in split_text(text):
        limit = int(max(MIN_PIECE_SECONDS, len(piece) * MAX_SECONDS_PER_CHAR) * SAMPLE_RATE)
        produced = 0
        stream = iter(engine.infer_stream(piece, voice.codes, voice.transcript))
        try:
            for wav in stream:
                if produced + len(wav) > limit:
                    log.warning("cut off a runaway generation after %.1f s (%d characters)", limit / SAMPLE_RATE, len(piece))
                    yield wav[: max(limit - produced, 0)]
                    break
                produced += len(wav)
                yield wav
        finally:
            close = getattr(stream, "close", None)
            if close is not None:
                close()  # stops llama.cpp generating the rest of an abandoned piece


def _produce(chunks: queue.Queue[bytes], cancelled: threading.Event, stream: Iterator[np.ndarray]) -> None:
    """Moves audio from NeuTTS's blocking generator into the queue until done or cancelled."""
    try:
        for wav in stream:
            pcm = to_pcm16(wav)
            while not cancelled.is_set():
                try:
                    chunks.put(pcm, timeout=POLL_SECONDS)
                    break
                except queue.Full:
                    continue
            if cancelled.is_set():
                return
    except Exception:  # noqa: BLE001 - the response has started; log and end it
        log.exception("generation failed")


async def generate(engine: SpeechEngine, text: str, voice: Voice) -> AsyncIterator[bytes]:
    """Runs the blocking stream in a thread and relays chunks as they arrive."""
    async with generation_lock:
        chunks: queue.Queue[bytes] = queue.Queue(maxsize=QUEUED_CHUNKS)
        cancelled = threading.Event()
        stream = speak_pieces(engine, text, voice)
        worker = threading.Thread(target=_produce, args=(chunks, cancelled, stream), daemon=True)
        worker.start()
        try:
            while True:
                try:
                    yield await asyncio.to_thread(chunks.get, True, POLL_SECONDS)
                except queue.Empty:
                    if not worker.is_alive() and chunks.empty():
                        break
        finally:
            cancelled.set()
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
    if state.engine is None or state.voices is None:
        return error(503, "the model is still loading", "not_ready")
    requested = str(body.get("voice") or "default").lower()
    name = DEFAULT_VOICE if requested == "default" else requested
    voice = state.voices.get(name)
    if voice is None:
        return error(400, f"unknown voice {requested!r}", "unknown_voice")
    return StreamingResponse(generate(state.engine, text.strip(), voice), media_type="application/octet-stream")
