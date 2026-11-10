"""Tests for uploaded voices on the Pocket server: ids, sources, prepare and delete."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import server
import user_voices
from test_server import FakeEngine
from user_voices import AudioInfo, Voice

VOICE_ID = "k7m2q4z6x3b5n"


@pytest.fixture()
def uploads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(user_voices, "USER_VOICES_DIR", tmp_path)
    return tmp_path


def add_clip(directory: Path, voice_id: str = VOICE_ID, ext: str = "ogg") -> Path:
    folder = directory / voice_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"source.{ext}"
    path.write_bytes(b"audio")
    return path


@pytest.fixture()
def engine() -> Iterator[FakeEngine]:
    fake = FakeEngine()
    fake.forgotten = []  # type: ignore[attr-defined]
    fake.forget = lambda voice: fake.forgotten.append(voice.name)  # type: ignore[method-assign]
    server.state.engine = fake
    server.state.voices = {"alba": Voice("alba")}
    yield fake
    server.state.engine = None
    server.state.voices = {}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(server.app)


def probe_returning(duration: float):
    return lambda _path: AudioInfo(duration=duration, sample_rate=48_000, channels=2)


def test_ids_and_names() -> None:
    assert user_voices.is_user_voice_id(VOICE_ID)
    assert not user_voices.is_user_voice_id("K7M2Q4Z9X3B5N")
    assert not user_voices.is_user_voice_id("../etc/passwd")
    assert user_voices.parse_user_voice(f"user:{VOICE_ID}") == VOICE_ID
    assert user_voices.parse_user_voice("user:nope") is None
    assert user_voices.parse_user_voice("alba") is None
    assert Voice(f"user:{VOICE_ID}", custom=True).cache_name == f"user-{VOICE_ID}"


def test_source_must_be_exactly_one_file(uploads: Path) -> None:
    assert user_voices.find_source(uploads, VOICE_ID) is None
    path = add_clip(uploads)
    assert user_voices.find_source(uploads, VOICE_ID) == path
    add_clip(uploads, ext="wav")
    assert user_voices.find_source(uploads, VOICE_ID) is None


def test_stale_cached_states_are_those_without_an_upload_folder(tmp_path: Path) -> None:
    cache, uploads = tmp_path / "cache", tmp_path / "uploads"
    cache.mkdir()
    add_clip(uploads)
    kept = cache / f"user-{VOICE_ID}-123.safetensors"
    stale = cache / "user-aaaaaaaaaaaaa-456.safetensors"
    curated = cache / "rekp-789.safetensors"
    for path in (kept, stale, curated):
        path.write_bytes(b"")
    assert user_voices.stale_cached_states(cache, uploads) == [stale]


def test_prepare_checks_the_clip_and_clones_it(
    uploads: Path, engine: FakeEngine, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    add_clip(uploads)
    monkeypatch.setattr(user_voices, "probe_audio", probe_returning(42.5))
    response = client.post(f"/v1/user-voices/{VOICE_ID}/prepare")
    assert response.status_code == 200
    assert response.json() == {"id": VOICE_ID, "durationSec": 42.5, "sampleRate": 48_000, "channels": 2, "truncated": True}
    assert engine.prepared == [f"user:{VOICE_ID}"]


@pytest.mark.parametrize(
    ("duration", "code"),
    [(1.0, "too_short"), (90.0, "too_long")],
)
def test_prepare_rejects_clips_outside_the_duration_limits(
    uploads: Path, engine: FakeEngine, client: TestClient, monkeypatch: pytest.MonkeyPatch, duration: float, code: str
) -> None:
    add_clip(uploads)
    monkeypatch.setattr(user_voices, "probe_audio", probe_returning(duration))
    response = client.post(f"/v1/user-voices/{VOICE_ID}/prepare")
    assert (response.status_code, response.json()["error"]["code"]) == (400, code)
    assert engine.prepared == []


def test_prepare_rejects_unreadable_missing_and_malformed(
    uploads: Path, engine: FakeEngine, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert client.post(f"/v1/user-voices/{VOICE_ID}/prepare").json()["error"]["code"] == "not_found"
    assert client.post("/v1/user-voices/NOT-AN-ID/prepare").json()["error"]["code"] == "invalid_id"
    add_clip(uploads)

    def broken(_path: Path) -> AudioInfo:
        raise RuntimeError("not audio")

    monkeypatch.setattr(user_voices, "probe_audio", broken)
    assert client.post(f"/v1/user-voices/{VOICE_ID}/prepare").json()["error"]["code"] == "unsupported_audio"


def test_prepare_reports_a_failed_clone(
    uploads: Path, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    server.state.engine = FakeEngine(fail_on=f"user:{VOICE_ID}")
    try:
        add_clip(uploads)
        monkeypatch.setattr(user_voices, "probe_audio", probe_returning(10.0))
        response = client.post(f"/v1/user-voices/{VOICE_ID}/prepare")
        assert (response.status_code, response.json()["error"]["code"]) == (500, "clone_failed")
    finally:
        server.state.engine = None


def test_delete_forgets_the_voice_and_is_idempotent(engine: FakeEngine, client: TestClient) -> None:
    assert client.delete(f"/v1/user-voices/{VOICE_ID}").status_code == 204
    assert client.delete(f"/v1/user-voices/{VOICE_ID}").status_code == 204
    assert engine.forgotten == [f"user:{VOICE_ID}", f"user:{VOICE_ID}"]  # type: ignore[attr-defined]
    assert client.delete("/v1/user-voices/bad").status_code == 400


def test_speech_resolves_uploaded_voices_by_id(uploads: Path, engine: FakeEngine, client: TestClient) -> None:
    add_clip(uploads)
    response = client.post("/v1/audio/speech", json={"input": "hi", "voice": f"user:{VOICE_ID}", "response_format": "pcm"})
    assert response.status_code == 200
    assert np.frombuffer(response.content, dtype="<i2").size == 3 * 2400
    assert engine.calls == [(f"user:{VOICE_ID}", "hi")]
    missing = client.post("/v1/audio/speech", json={"input": "hi", "voice": "user:aaaaaaaaaaaaa", "response_format": "pcm"})
    assert missing.json()["error"]["code"] == "unknown_voice"


def test_uploaded_voices_are_not_listed(engine: FakeEngine, client: TestClient, uploads: Path) -> None:
    add_clip(uploads)
    assert client.get("/v1/audio/voices").json()["custom"] == []
    assert os.path.isdir(uploads / VOICE_ID)
