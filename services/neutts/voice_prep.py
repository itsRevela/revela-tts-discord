"""Turns custom voice recordings into NeuTTS references.

For every <Name>.wav in the sources folder that has no up-to-date reference yet:
  1. trim it to a clean clip of up to MAX_SECONDS, cut at a pause;
  2. transcribe the clip with Whisper (unless <Name>.txt already exists);
  3. encode the clip with NeuCodec.
Results go to <cache>/<Name>.pt (codes), <Name>.txt (transcript, editable) and
<Name>.ref.wav (the trimmed clip, for listening). A recording newer than its
codes is prepared again, and then its transcript is regenerated.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

SAMPLE_RATE = 16_000
MIN_SECONDS = 6.0
MAX_SECONDS = 12.0
FRAME_SECONDS = 0.03
SILENCE_RATIO = 0.08
MIN_PAUSE_SECONDS = 0.15

log = logging.getLogger("neutts-voice-prep")

Transcriber = Callable[[np.ndarray], str]
Encoder = Callable[[np.ndarray], Any]


@dataclass(frozen=True)
class PreparedPaths:
    codes: Path
    transcript: Path
    clip: Path


def paths_for(cache_dir: Path, name: str) -> PreparedPaths:
    return PreparedPaths(cache_dir / f"{name}.pt", cache_dir / f"{name}.txt", cache_dir / f"{name}.ref.wav")


def needs_preparation(source: Path, cache_dir: Path) -> bool:
    codes = paths_for(cache_dir, source.stem).codes
    return not codes.exists() or source.stat().st_mtime > codes.stat().st_mtime


def frame_levels(wav: np.ndarray, frame: int) -> np.ndarray:
    usable = len(wav) - len(wav) % frame
    if usable == 0:
        return np.zeros(0)
    return np.sqrt(np.mean(wav[:usable].reshape(-1, frame) ** 2, axis=1))


def trim_reference(wav: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Drops leading silence, then ends the clip at the last pause between
    MIN_SECONDS and MAX_SECONDS (or at MAX_SECONDS when there is none)."""
    frame = int(FRAME_SECONDS * sample_rate)
    levels = frame_levels(wav, frame)
    if levels.size == 0:
        return wav
    loud = levels > SILENCE_RATIO * np.percentile(levels, 95)
    first = int(np.argmax(loud)) if loud.any() else 0
    start = first * frame
    min_end, max_end = start + int(MIN_SECONDS * sample_rate), start + int(MAX_SECONDS * sample_rate)
    if len(wav) <= max_end:
        return wav[start:]
    pause_frames = max(1, int(MIN_PAUSE_SECONDS / FRAME_SECONDS))
    best_end = max_end
    for index in range(first, len(levels) - pause_frames):
        position = index * frame
        if position < min_end or position > max_end:
            continue
        if not loud[index : index + pause_frames].any():
            best_end = position + (pause_frames // 2) * frame
    return wav[start:best_end]


def prepare_voice(source: Path, cache_dir: Path, transcribe: Transcriber, encode: Encoder) -> None:
    import librosa
    import soundfile
    import torch

    paths = paths_for(cache_dir, source.stem)
    wav, _ = librosa.load(source, sr=SAMPLE_RATE, mono=True)
    clip = trim_reference(wav.astype(np.float32))
    regenerate_transcript = paths.codes.exists() or not paths.transcript.exists()
    if regenerate_transcript:
        paths.transcript.write_text(transcribe(clip).strip() + "\n", encoding="utf-8")
    torch.save(encode(clip), paths.codes)
    soundfile.write(paths.clip, clip, SAMPLE_RATE)
    log.info("prepared custom voice %s (%.1f s)", source.stem, len(clip) / SAMPLE_RATE)


def load_tools() -> tuple[Transcriber, Encoder]:
    """Whisper and the NeuCodec encoder; only loaded when a voice needs preparing."""
    import torch
    from neucodec import NeuCodec
    from transformers import pipeline

    asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en", device="cpu")
    codec = NeuCodec.from_pretrained("neuphonic/neucodec")
    codec.eval()

    def transcribe(clip: np.ndarray) -> str:
        return str(asr({"raw": clip, "sampling_rate": SAMPLE_RATE})["text"])

    def encode(clip: np.ndarray) -> Any:
        tensor = torch.from_numpy(clip).float().unsqueeze(0).unsqueeze(0)
        with torch.no_grad():
            return codec.encode_code(audio_or_path=tensor).squeeze(0).squeeze(0)

    return transcribe, encode


def prepare_custom_voices(
    sources_dir: Path,
    cache_dir: Path,
    tools: Callable[[], tuple[Transcriber, Encoder]] = load_tools,
) -> list[str]:
    """Prepares every recording that needs it; returns the names prepared.
    A recording that fails is logged and skipped so the others still work."""
    if not sources_dir.is_dir():
        return []
    pending = [source for source in sorted(sources_dir.glob("*.wav")) if needs_preparation(source, cache_dir)]
    if not pending:
        return []
    cache_dir.mkdir(parents=True, exist_ok=True)
    transcribe, encode = tools()
    prepared: list[str] = []
    for source in pending:
        try:
            prepare_voice(source, cache_dir, transcribe, encode)
            prepared.append(source.stem)
        except Exception:  # noqa: BLE001 - one bad recording must not stop the rest
            log.exception("could not prepare custom voice %s", source.stem)
    return prepared
