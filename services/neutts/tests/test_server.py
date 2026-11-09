"""Tests for the NeuTTS HTTP server with a fake engine (no torch or model needed).

Run: docker run --rm -v "$PWD/services/neutts:/app" -w /app python:3.12-slim \
       sh -c "pip install -q fastapi==0.162.2 httpx numpy pytest && python -m pytest -q"
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import server


class FakeEngine:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any, str]] = []

    def infer_stream(self, text: str, ref_codes: Any, ref_text: str) -> Iterator[np.ndarray]:
        self.calls.append((text, ref_codes, ref_text))
        for _ in range(3):
            yield np.full(2400, 0.5, dtype=np.float32)


@pytest.fixture()
def engine() -> Iterator[FakeEngine]:
    fake = FakeEngine()
    server.state.engine = fake
    server.state.voices = {
        "jo": server.Voice("jo-codes", "jo transcript", "jo"),
        "dave": server.Voice("dave-codes", "dave", "dave"),
        "tony balogna": server.Voice("tony-codes", "tony transcript", "Tony Balogna", custom=True),
    }
    yield fake
    server.state.engine = None
    server.state.voices = None


@pytest.fixture()
def client() -> TestClient:
    # Without "with", TestClient skips the lifespan, so no real model loads.
    return TestClient(server.app)


def speak(client: TestClient, **body: Any):
    return client.post("/v1/audio/speech", json={"response_format": "pcm", **body})


def test_health_and_voice_list(engine: FakeEngine, client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/v1/audio/voices").json() == {
        "voices": ["dave", "jo", "default"],
        "custom": ["Tony Balogna"],
        "aliases": {},
    }


def test_streams_pcm16_for_the_requested_voice(engine: FakeEngine, client: TestClient) -> None:
    response = speak(client, input="  Hello there  ", voice="Dave")
    assert response.status_code == 200
    samples = np.frombuffer(response.content, dtype="<i2")
    assert samples.size == 3 * 2400
    assert samples[0] == round(0.5 * 32767)
    assert engine.calls == [("Hello there", "dave-codes", "dave")]


def test_custom_voices_are_requested_by_name(engine: FakeEngine, client: TestClient) -> None:
    assert speak(client, input="hi", voice="Tony Balogna").status_code == 200
    assert engine.calls[-1] == ("hi", "tony-codes", "tony transcript")


def test_default_voice_is_jo(engine: FakeEngine, client: TestClient) -> None:
    speak(client, input="hi")
    assert engine.calls[-1][1] == "jo-codes"


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"input": "", "voice": "jo"}, "invalid_input"),
        ({"input": "x" * 5000}, "input_too_long"),
        ({"input": "hi", "voice": "nobody"}, "unknown_voice"),
        ({"input": "hi", "response_format": "mp3"}, "unsupported_format"),
    ],
)
def test_rejects_bad_requests(engine: FakeEngine, client: TestClient, body: dict[str, Any], code: str) -> None:
    response = client.post("/v1/audio/speech", json={"response_format": "pcm", **body})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_not_ready_before_the_model_loads(client: TestClient) -> None:
    response = speak(client, input="hi")
    assert response.status_code == 503


class EndlessEngine:
    """Never stops on its own, like a generation that lost its place in the text."""

    def __init__(self) -> None:
        self.pieces: list[str] = []
        self.closed = 0

    def infer_stream(self, text: str, ref_codes: Any, ref_text: str) -> Iterator[np.ndarray]:
        self.pieces.append(text)
        try:
            while True:
                yield np.zeros(2400, dtype=np.float32)
        finally:
            self.closed += 1


def test_long_text_is_spoken_piece_by_piece() -> None:
    fake = FakeEngine()
    text = "First sentence here. " * 12
    audio = list(server.speak_pieces(fake, text, server.Voice("codes", "ref")))
    assert len(fake.calls) > 1
    assert " ".join(call[0] for call in fake.calls) == " ".join(text.split())
    assert len(audio) == 3 * len(fake.calls)


def test_runaway_pieces_are_cut_off_and_stopped() -> None:
    engine = EndlessEngine()
    audio = list(server.speak_pieces(engine, "Short one.", server.Voice("codes", "ref")))
    seconds = sum(len(chunk) for chunk in audio) / server.SAMPLE_RATE
    assert seconds == server.MIN_PIECE_SECONDS
    assert engine.closed == 1


def test_pcm_conversion_clamps() -> None:
    pcm = np.frombuffer(server.to_pcm16(np.array([2.0, -2.0, 0.0], dtype=np.float32)), dtype="<i2")
    assert pcm.tolist() == [32767, -32767, 0]
