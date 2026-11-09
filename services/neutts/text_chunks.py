"""Splits long input so each NeuTTS generation fits its 2048-token context.

One request holds the reference codes (about 50 per second of reference),
the reference transcript, the input text, and the generated speech codes
(about 50 per second of speech, roughly 5 per character). With a 12 s
reference, input much over ~200 characters runs out of room and speech stops
mid-sentence, so text is spoken in pieces of at most MAX_CHARS characters.
"""

from __future__ import annotations

import re

MAX_CHARS = 120
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
_CLAUSE_END = re.compile(r"(?<=[,;:])\s+")


def _split_long(sentence: str, max_chars: int) -> list[str]:
    """Breaks one over-long sentence at commas, then at spaces."""
    if len(sentence) <= max_chars:
        return [sentence]
    parts: list[str] = []
    current = ""
    for clause in _CLAUSE_END.split(sentence):
        for word in clause.split(" ") if len(clause) > max_chars else [clause]:
            candidate = f"{current} {word}".strip()
            if current and len(candidate) > max_chars:
                parts.append(current)
                current = word
            else:
                current = candidate
    if current:
        parts.append(current)
    return parts


def split_text(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """Groups whole sentences into pieces of at most `max_chars` characters."""
    sentences = [s for s in _SENTENCE_END.split(" ".join(text.split())) if s]
    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        for part in _split_long(sentence, max_chars):
            candidate = f"{current} {part}".strip()
            if current and len(candidate) > max_chars:
                pieces.append(current)
                current = part
            else:
                current = candidate
    if current:
        pieces.append(current)
    return pieces
