"""Voices uploaded by Discord users. The bot owns their catalog and stores each
clip as <POCKET_USER_VOICES_DIR>/<id>/source.<ext>; this server only clones them
on demand. Ids are 13 lowercase base32 characters; paths are built from ids only.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from voices import Voice

USER_VOICES_DIR = Path(os.environ.get("POCKET_USER_VOICES_DIR", "/user-voices"))
MIN_SECONDS = float(os.environ.get("POCKET_USER_VOICE_MIN_SECONDS", "3"))
MAX_SECONDS = float(os.environ.get("POCKET_USER_VOICE_MAX_SECONDS", "60"))
# Kyutai clones from at most this much of the clip (truncate=True).
CLONED_SECONDS = 30.0
PREFIX = "user:"
_ID = re.compile(r"^[a-z2-7]{13}$")


@dataclass(frozen=True)
class AudioInfo:
    duration: float
    sample_rate: int
    channels: int


def is_user_voice_id(voice_id: str) -> bool:
    return bool(_ID.match(voice_id))


def parse_user_voice(name: str) -> str | None:
    """The id in "user:<id>", or None for any other voice name."""
    if not name.startswith(PREFIX):
        return None
    voice_id = name[len(PREFIX):]
    return voice_id if is_user_voice_id(voice_id) else None


def find_source(directory: Path, voice_id: str) -> Path | None:
    """The single source.<ext> file for an id; None when there is none or more than one."""
    folder = directory / voice_id
    files = [path for path in folder.glob("source.*") if path.is_file()] if folder.is_dir() else []
    return files[0] if len(files) == 1 else None


def user_voice(voice_id: str, directory: Path | None = None) -> Voice | None:
    source = find_source(directory or USER_VOICES_DIR, voice_id)
    return Voice(f"{PREFIX}{voice_id}", custom=True, source=source) if source else None


def forgotten_user_voice(voice_id: str) -> Voice:
    """A user voice whose clip may already be gone, for clearing its cached clone."""
    return Voice(f"{PREFIX}{voice_id}", custom=True)


def stale_cached_states(cache_dir: Path, directory: Path) -> list[Path]:
    """Cached clones of user voices whose upload folder no longer exists."""
    stale: list[Path] = []
    for path in cache_dir.glob("user-*.safetensors") if cache_dir.is_dir() else []:
        voice_id = path.name[len("user-"):].split("-", 1)[0]
        if not (directory / voice_id).is_dir():
            stale.append(path)
    return stale


def probe_audio(path: Path) -> AudioInfo:
    """Decodes the clip's header with libsndfile (WAV, FLAC, OGG, MP3); raises if it can't."""
    import soundfile  # deferred: tests replace this function

    info = soundfile.info(str(path))
    return AudioInfo(duration=float(info.duration), sample_rate=int(info.samplerate), channels=int(info.channels))
