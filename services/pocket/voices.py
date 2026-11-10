"""Which voices the Pocket server offers: Kyutai's English voices and custom recordings."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

CUSTOM_SOURCES_DIR = Path(os.environ.get("POCKET_CUSTOM_SOURCES_DIR", "/voices"))

# Kyutai's predefined English voices (pocket_tts.utils.utils._ORIGINS_OF_PREDEFINED_VOICES).
BUILTIN_VOICES: tuple[str, ...] = (
    "alba", "anna", "azelma", "bill_boerst", "caro_davy", "charles", "cosette", "eponine", "eve",
    "fantine", "george", "jane", "jean", "javert", "marius", "mary", "michael", "paul",
    "peter_yearsley", "stuart_bell", "vera",
)


@dataclass(frozen=True)
class Voice:
    """A built-in voice (by Kyutai name) or a custom one cloned from `source`."""

    name: str
    custom: bool = False
    source: Path | None = None

    @property
    def cache_name(self) -> str:
        """File-safe name for cached clones ("user:abc" becomes "user-abc")."""
        return self.name.replace(":", "-")


def custom_voices(directory: Path) -> dict[str, Voice]:
    """Every <Name>.wav in `directory`, keyed by lowercase name."""
    files = sorted(directory.glob("*.wav")) if directory.is_dir() else []
    return {path.stem.lower(): Voice(path.stem, custom=True, source=path) for path in files}


def discover_voices(directory: Path = CUSTOM_SOURCES_DIR) -> dict[str, Voice]:
    """Custom recordings and built-in voices; a custom voice named like a built-in one is shadowed by it."""
    builtin = {name: Voice(name) for name in BUILTIN_VOICES}
    return {**custom_voices(directory), **builtin}


def voice_names(voices: dict[str, Voice]) -> tuple[list[str], list[str]]:
    """Built-in names (sorted, plus "default") and custom display names (sorted)."""
    builtin = sorted(key for key, voice in voices.items() if not voice.custom)
    custom = sorted((voice.name for voice in voices.values() if voice.custom), key=str.lower)
    return [*builtin, "default"], custom
