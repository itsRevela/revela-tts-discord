"""Tests for the Pocket HTTP server with a fake engine (no torch or model needed).

Run: docker run --rm -v "$PWD/services/pocket:/app" -w /app python:3.12-slim \
       sh -c "pip install -q fastapi==0.162.2 httpx numpy pytest && python -m pytest -q"
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import server
from voices import Voice


class FakeEngine:
    def __init__(self, chunks: int = 3, fail_on: str | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.prepared: list[str] = []
        self.stopped: list[bool] = []
        self._chunks = chunks
        self._fail_on = fail_on

    def prepare(self, voice: Voice) -> None:
        if voice.name == self._fail_on:
            raise RuntimeError("bad recording")
        self.prepared.append(voice.name)

    def stream(self, voice: Voice, text: str, stop: threading.Event) -> Iterator[np.ndarray]:
        self.calls.append((voice.name, text))
        for _ in range(self._chunks):
            if stop.is_set():
                break
            yield np.full(2400, 0.5, dtype=np.float32)
        self.stopped.append(stop.is_set())


VOICES = {
    "alba": Voice("alba"),
    "marius": Voice("marius"),
    "tony balogna": Voice("Tony Balogna", custom=True, source=Path("/voices/Tony Balogna.wav")),
}


@pytest.fixture()
def engine() -> Iterator[FakeEngine]:
    fake = FakeEngine()
    server.state.engine = fake
    server.state.voices = dict(VOICES)
    yield fake
    server.state.engine = None
    server.state.voices = {}


@pytest.fixture()
def client() -> TestClient:
    # Without "with", TestClient skips the lifespan, so no real model loads.
    return TestClient(server.app)


def speak(client: TestClient, **body: Any):
    return client.post("/v1/audio/speech", json={"response_format": "pcm", **body})


def test_health_and_voice_list(engine: FakeEngine, client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/v1/audio/voices").json() == {
        "voices": ["alba", "marius", "default"],
        "custom": ["Tony Balogna"],
        "aliases": {},
    }


def test_streams_pcm16_for_the_requested_voice(engine: FakeEngine, client: TestClient) -> None:
    response = speak(client, input="  Hello there  ", voice="Marius")
    assert response.status_code == 200
    samples = np.frombuffer(response.content, dtype="<i2")
    assert samples.size == 3 * 2400
    assert samples[0] == round(0.5 * 32767)
    assert engine.calls == [("marius", "Hello there")]


def test_custom_voices_by_name_and_default_is_alba(engine: FakeEngine, client: TestClient) -> None:
    assert speak(client, input="hi", voice="Tony Balogna").status_code == 200
    speak(client, input="hi")
    assert engine.calls == [("Tony Balogna", "hi"), ("alba", "hi")]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"input": "   "}, "invalid_input"),
        ({"input": "x" * 5000}, "input_too_long"),
        ({"input": "hi", "response_format": "mp3"}, "unsupported_format"),
        ({"input": "hi", "voice": "nobody"}, "unknown_voice"),
    ],
)
def test_rejects_bad_requests(engine: FakeEngine, client: TestClient, body: dict[str, Any], code: str) -> None:
    response = client.post("/v1/audio/speech", json=body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_not_ready_until_the_model_loads(client: TestClient) -> None:
    assert speak(client, input="hi").status_code == 503


def test_stop_is_signalled_when_generation_ends(engine: FakeEngine, client: TestClient) -> None:
    speak(client, input="hi")
    assert engine.stopped == [False]


def test_a_voice_that_fails_to_prepare_is_left_out() -> None:
    ready = server.prepare_voices(FakeEngine(fail_on="Tony Balogna"), dict(VOICES))
    assert sorted(ready) == ["alba", "marius"]


def test_pcm_conversion_clamps() -> None:
    samples = np.frombuffer(server.to_pcm16(np.array([2.0, -2.0, 0.0], dtype=np.float32)), dtype="<i2")
    assert samples.tolist() == [32767, -32767, 0]
