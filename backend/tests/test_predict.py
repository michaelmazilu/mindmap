"""Unit tests for prediction parsing (no live Anthropic calls)."""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import (  # noqa: E402
    extract_text_from_message,
    normalize_prediction,
    parse_prediction_json,
)


def test_parse_json_with_fence():
    raw = '```json\n{"regions":[{"name":"Amygdala","activation":0.8,"function":"threat"}],"interpretation":"Test."}\n```'
    d = parse_prediction_json(raw)
    assert d["regions"][0]["name"] == "Amygdala"


def test_parse_json_embedded():
    raw = 'Here you go {"regions":[],"interpretation":"x"} thanks'
    d = parse_prediction_json(raw)
    assert d["interpretation"] == "x"


def test_normalize_pads_regions():
    d = normalize_prediction({"regions": [{"name": "A", "activation": "0.5", "function": "f"}], "interpretation": "i"})
    assert len(d["regions"]) == 3
    assert d["regions"][0]["activation"] == 0.5


def test_normalize_invalid_activation():
    d = normalize_prediction(
        {"regions": [{"name": "X", "activation": "nope", "function": "y"}], "interpretation": "z"}
    )
    assert d["regions"][0]["activation"] == 0.5


def test_extract_text_skips_thinking():
    response = SimpleNamespace(
        content=[
            SimpleNamespace(type="thinking", thinking="..."),
            SimpleNamespace(
                type="text",
                text='{"regions":[],"interpretation":"ok"}',
            ),
        ]
    )
    assert "interpretation" in extract_text_from_message(response)


def test_extract_text_empty_raises():
    from fastapi import HTTPException

    response = SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking="only")])
    with pytest.raises(HTTPException) as exc:
        extract_text_from_message(response)
    assert exc.value.status_code == 502
