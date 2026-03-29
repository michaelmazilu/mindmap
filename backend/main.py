"""
Mindmap Backend — FastAPI server for brain activation prediction.

MVP mode: Uses Claude to simulate brain region predictions.
Production mode: Swap in TRIBE v2 pipeline (see tribe_runner.py).
"""

import hashlib
import json
import logging
import os
import re
from typing import Any, Optional

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from cache import ActivationCache

logger = logging.getLogger(__name__)

app = FastAPI(title="Mindmap API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

cache = ActivationCache()
claude_client: Optional[anthropic.Anthropic] = None

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

# __TWEET_BODY__ replaced with json.dumps(tweet) so braces in tweets cannot break the prompt.
CLAUDE_PROMPT_TEMPLATE = """You are a neuroscience prediction engine. Analyze this tweet and predict which brain regions would activate most strongly when reading it. Return ONLY valid JSON, no other text.

Format:
{"regions":[{"name":"REGION_NAME","activation":0.XX,"function":"brief function description"}],"interpretation":"One sentence, max 20 words, explaining what this activation pattern means for emotional/cognitive response. Be specific and slightly unsettling — expose manipulation."}

Rules:
- Return exactly 3 regions
- activation values between 0.20 and 0.95
- Use real neuroscience region names (e.g. Amygdala, Anterior Cingulate Cortex, Broca's Area, Visual Cortex, Prefrontal Cortex, Insula, Temporal Pole, Fusiform Gyrus, Precuneus, Wernicke's Area, Orbitofrontal Cortex, Dorsolateral PFC, Ventromedial PFC, Superior Temporal Sulcus, Motor Cortex)
- function: 2-4 words describing what the region does
- interpretation must be unsettling/revealing about the tweet's psychological effect

Tweet:
__TWEET_BODY__"""


class PredictRequest(BaseModel):
    tweet_text: str


class RegionResult(BaseModel):
    name: str
    activation: float
    function: str

    @field_validator("activation", mode="before")
    @classmethod
    def coerce_activation(cls, v: Any) -> float:
        if v is None:
            return 0.5
        if isinstance(v, (int, float)):
            return float(v)
        try:
            return float(str(v).strip())
        except ValueError:
            return 0.5


class PredictResponse(BaseModel):
    regions: list[RegionResult]
    interpretation: str


def get_claude_client() -> anthropic.Anthropic:
    global claude_client
    if claude_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY not configured on server",
            )
        claude_client = anthropic.Anthropic(api_key=api_key)
    return claude_client


def hash_text(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode()).hexdigest()[:16]


def extract_text_from_message(response: Any) -> str:
    """Collect all `text` blocks (skip thinking / tool blocks)."""
    parts: list[str] = []
    for block in response.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            parts.append(getattr(block, "text", "") or "")
    text = "".join(parts).strip()
    if text:
        return text
    # Fallback: first block with .text
    if response.content:
        first = response.content[0]
        if hasattr(first, "text"):
            return (first.text or "").strip()
    logger.error(
        "Claude returned no text blocks; types=%s",
        [getattr(b, "type", type(b).__name__) for b in response.content],
    )
    raise HTTPException(
        status_code=502,
        detail="Claude response contained no text output",
    )


def parse_prediction_json(raw_text: str) -> dict:
    s = raw_text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```\s*$", "", s)
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("No JSON object found in model output")
    return json.loads(s[start : end + 1])


def normalize_prediction(data: dict) -> dict:
    raw_regions = data.get("regions")
    if not isinstance(raw_regions, list):
        raw_regions = []

    regions: list[dict] = []
    for r in raw_regions:
        if not isinstance(r, dict):
            continue
        try:
            act = float(r.get("activation", 0.5))
        except (TypeError, ValueError):
            act = 0.5
        act = max(0.0, min(1.0, act))
        regions.append(
            {
                "name": str(r.get("name", "Association cortex"))[:160],
                "activation": act,
                "function": str(r.get("function", "information processing"))[:240],
            }
        )

    while len(regions) < 3:
        regions.append(
            {
                "name": "Prefrontal cortex",
                "activation": 0.35,
                "function": "executive control",
            }
        )

    interp = data.get("interpretation", "")
    if not isinstance(interp, str):
        interp = str(interp)

    return {"regions": regions[:3], "interpretation": interp.strip()[:600]}


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    text = req.tweet_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty tweet text")
    if len(text) > 4000:
        text = text[:4000]

    cache_key = hash_text(text)

    cached = cache.get(cache_key)
    if cached:
        try:
            return PredictResponse(**normalize_prediction(cached))
        except Exception:
            pass

    client = get_claude_client()

    prompt = CLAUDE_PROMPT_TEMPLATE.replace(
        "__TWEET_BODY__",
        json.dumps(text, ensure_ascii=False),
    )

    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.APIStatusError as e:
        logger.exception("Anthropic API error")
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic API error: {e.status_code} {e.message}",
        ) from e
    except anthropic.APIError as e:
        logger.exception("Anthropic client error")
        raise HTTPException(status_code=502, detail=str(e)[:300]) from e

    raw_text = extract_text_from_message(response)

    try:
        parsed = parse_prediction_json(raw_text)
        normalized = normalize_prediction(parsed)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Bad JSON from Claude: %s | snippet=%r", e, raw_text[:400])
        raise HTTPException(
            status_code=502,
            detail="Model returned invalid JSON; retry or shorten tweet.",
        ) from e

    try:
        out = PredictResponse(**normalized)
    except Exception as e:
        logger.exception("Response validation failed: %s", normalized)
        raise HTTPException(status_code=502, detail="Prediction shape invalid") from e

    cache.set(cache_key, normalized, ttl=604800)
    return out


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
