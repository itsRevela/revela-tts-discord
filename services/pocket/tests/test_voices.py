"""Tests for the Pocket server's voice discovery."""

from __future__ import annotations

from pathlib import Path

from voices import BUILTIN_VOICES, Voice, discover_voices, voice_names


def test_builtin_voices_are_kyutais_21_english_voices() -> None:
    assert len(BUILTIN_VOICES) == 21
    assert "alba" in BUILTIN_VOICES and "peter_yearsley" in BUILTIN_VOICES


def test_custom_recordings_are_found_and_builtin_names_win(tmp_path: Path) -> None:
    for name in ("Tony Balogna.wav", "rekp.wav", "alba.wav", "notes.txt"):
        (tmp_path / name).write_bytes(b"")
    voices = discover_voices(tmp_path)
    assert voices["tony balogna"] == Voice("Tony Balogna", custom=True, source=tmp_path / "Tony Balogna.wav")
    assert voices["rekp"].custom
    assert voices["alba"] == Voice("alba")
    assert "notes" not in voices


def test_missing_folder_means_no_custom_voices(tmp_path: Path) -> None:
    voices = discover_voices(tmp_path / "missing")
    assert not any(voice.custom for voice in voices.values())


def test_voice_names_lists_builtins_then_default_and_custom_separately() -> None:
    voices = {"marius": Voice("marius"), "alba": Voice("alba"), "rekp": Voice("rekp", custom=True)}
    assert voice_names(voices) == (["alba", "marius", "default"], ["rekp"])
