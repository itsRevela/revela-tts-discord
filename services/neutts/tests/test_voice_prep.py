"""Tests for custom voice preparation. They need librosa, soundfile and torch,
so they run inside the built image:

docker run --rm --user root -v "$PWD/services/neutts:/opt/neutts/src" -w /opt/neutts/src \
  revela-tts-neutts sh -c "pip install -q pytest httpx && python -m pytest -q"
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest

voice_prep = pytest.importorskip("voice_prep")
pytest.importorskip("librosa")

RATE = voice_prep.SAMPLE_RATE
TRANSCRIPT = "hello there\n"


def tone(seconds: float) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * RATE), dtype=np.float32)


def test_trim_drops_leading_silence_and_ends_at_a_pause() -> None:
    wav = np.concatenate([silence(1.0), tone(4.0), silence(0.5), tone(4.0), silence(0.5), tone(8.0)])
    clip = voice_prep.trim_reference(wav)
    seconds = len(clip) / RATE
    # Starts at the speech and ends inside the second pause (8.0 to 9.0 s in).
    assert np.abs(clip[: RATE // 10]).max() > 0.1
    assert 8.0 <= seconds <= 9.0


def test_trim_keeps_short_recordings_whole() -> None:
    wav = np.concatenate([silence(0.3), tone(5.0)])
    assert abs(len(voice_prep.trim_reference(wav)) / RATE - 5.0) < 0.05


def test_trim_cuts_at_the_maximum_without_pauses() -> None:
    assert len(voice_prep.trim_reference(tone(20.0))) == int(voice_prep.MAX_SECONDS * RATE)


def write_wav(path: Path, seconds: float) -> None:
    import soundfile

    path.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(path, tone(seconds), RATE)


def fake_tools(calls: list[str]):
    def tools():
        def transcribe(clip: np.ndarray) -> str:
            calls.append("transcribe")
            return " hello there "

        def encode(clip: np.ndarray):
            import torch

            calls.append("encode")
            return torch.arange(4)

        return transcribe, encode

    return tools


def test_prepares_new_recordings_once_and_keeps_edited_transcripts(tmp_path: Path) -> None:
    sources, cache = tmp_path / "voices", tmp_path / "voices" / "neutts"
    write_wav(sources / "Tony Balogna.wav", 3.0)
    calls: list[str] = []

    assert voice_prep.prepare_custom_voices(sources, cache, fake_tools(calls)) == ["Tony Balogna"]
    assert (cache / "Tony Balogna.txt").read_text() == TRANSCRIPT
    assert (cache / "Tony Balogna.pt").exists() and (cache / "Tony Balogna.ref.wav").exists()

    # Nothing new: no work, and an edited transcript stays.
    (cache / "Tony Balogna.txt").write_text("edited transcript\n")
    assert voice_prep.prepare_custom_voices(sources, cache, fake_tools(calls)) == []
    assert (cache / "Tony Balogna.txt").read_text() == "edited transcript\n"

    # A replaced recording is prepared again, transcript included.
    later = time.time() + 5
    os.utime(sources / "Tony Balogna.wav", (later, later))
    assert voice_prep.prepare_custom_voices(sources, cache, fake_tools(calls)) == ["Tony Balogna"]
    assert (cache / "Tony Balogna.txt").read_text() == TRANSCRIPT
    assert calls.count("encode") == 2


def test_a_transcript_written_before_preparation_is_kept(tmp_path: Path) -> None:
    sources, cache = tmp_path / "voices", tmp_path / "voices" / "neutts"
    cache.mkdir(parents=True)
    write_wav(sources / "sol.wav", 3.0)
    (cache / "sol.txt").write_text("my own words\n")
    voice_prep.prepare_custom_voices(sources, cache, fake_tools([]))
    assert (cache / "sol.txt").read_text() == "my own words\n"


def test_missing_sources_folder_means_nothing_to_do(tmp_path: Path) -> None:
    assert voice_prep.prepare_custom_voices(tmp_path / "absent", tmp_path / "cache", fake_tools([])) == []
