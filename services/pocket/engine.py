"""Kyutai's Pocket TTS model behind the server's SpeechEngine interface."""

from __future__ import annotations

import glob
import logging
import threading
from collections import OrderedDict
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import torch
from pocket_tts import TTSModel
from pocket_tts.models.model_state import export_model_state

from voices import Voice

log = logging.getLogger("pocket-engine")

# Voice states are large (they hold the model's memory of the voice prompt), so
# only the most recently used ones stay in RAM; the rest reload from disk quickly.
VOICES_IN_MEMORY = 4
STATE_CACHE_DIR = Path.home() / ".cache" / "pocket_voices"


def cached_state_path(voice: Voice) -> Path:
    """Where a custom voice's cloned state is kept; tied to the recording's change time."""
    assert voice.source is not None
    return STATE_CACHE_DIR / f"{voice.cache_name}-{voice.source.stat().st_mtime_ns}.safetensors"


class KyutaiEngine:
    def __init__(self, language: str, temperature: float | None, seed: int | None, threads: int) -> None:
        torch.set_num_threads(threads)
        self._model = TTSModel.load_model(language=language, temp=temperature)
        if not self._model.has_voice_cloning:
            log.warning("voice cloning weights are unavailable (accept kyutai/pocket-tts on Hugging Face); custom voices will fail")
        self._seed = seed
        self._states: OrderedDict[str, Any] = OrderedDict()
        self._lock = threading.Lock()

    def _clone(self, voice: Voice) -> Path:
        """Clones a custom recording once and caches the result; older caches of it are removed."""
        path = cached_state_path(voice)
        if not path.exists():
            STATE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            state = self._model.get_state_for_audio_prompt(voice.source, truncate=True)
            export_model_state(state, path)
            for stale in self._cached_files(voice):
                if stale != path:
                    stale.unlink(missing_ok=True)
            log.info("cloned custom voice %s", voice.name)
        return path

    @staticmethod
    def _cached_files(voice: Voice) -> list[Path]:
        return list(STATE_CACHE_DIR.glob(f"{glob.escape(voice.cache_name)}-*.safetensors"))

    def _load(self, voice: Voice) -> Any:
        source = self._clone(voice) if voice.custom else voice.name
        return self._model.get_state_for_audio_prompt(source)

    def _state(self, voice: Voice) -> Any:
        with self._lock:
            if voice.name in self._states:
                self._states.move_to_end(voice.name)
                return self._states[voice.name]
            state = self._load(voice)
            self._states[voice.name] = state
            while len(self._states) > VOICES_IN_MEMORY:
                self._states.popitem(last=False)
            return state

    def prepare(self, voice: Voice) -> None:
        # Downloads the built-in voice or clones the custom one now, without keeping it in RAM.
        if voice.custom:
            self._clone(voice)
        else:
            self._model.get_state_for_audio_prompt(voice.name)

    def forget(self, voice: Voice) -> None:
        """Drops a voice from memory and deletes its cached clone (for deleted uploads)."""
        with self._lock:
            self._states.pop(voice.name, None)
        for path in self._cached_files(voice):
            path.unlink(missing_ok=True)

    def stream(self, voice: Voice, text: str, stop: threading.Event) -> Iterator[np.ndarray]:
        state = self._state(voice)
        if self._seed is not None:
            torch.manual_seed(self._seed)
        for chunk in self._model.generate_audio_stream(state, text, stop=stop):
            yield chunk.numpy()
