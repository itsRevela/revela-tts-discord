"""Tests for splitting long input into NeuTTS-sized pieces."""

from __future__ import annotations

from text_chunks import MAX_CHARS, split_text

LONG = (
    "No. More. Saying. Cuss words! It. Is. Not. Good. I'm putting a video on YouTube about no more saying cuss "
    "words. No more saying cuss words guys! It's inappropriate and violent! If you say a cuss word then you're "
    "like, going to jail, and you're like, and when you go to jail, i- ba- when you go to jail, if you say, if "
    "you say a cuss word you go to jail and if you go to jail cause you said a cuss word, then... You're only "
    "gonna eat BROCCOLI and OTHER VEGETABLES for your WHOLE LIFE."
)


def test_short_text_stays_whole() -> None:
    assert split_text("  Is anyone up   for a match tonight?  ") == ["Is anyone up for a match tonight?"]


def test_long_text_keeps_every_word_in_order_within_the_limit() -> None:
    pieces = split_text(LONG)
    assert len(pieces) > 1
    assert all(len(piece) <= MAX_CHARS for piece in pieces)
    assert " ".join(pieces) == " ".join(LONG.split())


def test_sentences_are_grouped_not_split_one_per_piece() -> None:
    assert split_text("No. More. Saying. Cuss words!") == ["No. More. Saying. Cuss words!"]


def test_an_over_long_sentence_breaks_at_commas_then_spaces() -> None:
    sentence = "word " * 60
    pieces = split_text(sentence.strip(), max_chars=50)
    assert all(len(piece) <= 50 for piece in pieces)
    assert " ".join(pieces) == sentence.strip()
    clauses = split_text("alpha beta gamma, delta epsilon zeta, eta theta iota", max_chars=25)
    assert clauses == ["alpha beta gamma,", "delta epsilon zeta,", "eta theta iota"]
