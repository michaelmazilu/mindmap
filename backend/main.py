"""
Mindmap Backend — FastAPI server for brain activation prediction.

MVP mode: Uses Claude to simulate brain region predictions.
Production mode: Swap in TRIBE v2 pipeline (see tribe_runner.py).
"""

import hashlib
import json
import os
from typing import Optional

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from cache import ActivationCache

app = FastAPI(title="Mindmap API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

cache = ActivationCache()
claude_client: Optional[anthropic.Anthropic] = None

CLAUDE_PROMPT = """You are a neuroscience prediction engine. Analyze this tweet and predict which brain regions would activate most strongly when reading it. Return ONLY valid JSON, no other text.

Format:
{{"regions":[{{"name":"REGION_NAME","activation":0.XX,"function":"brief function description"}}],"interpretation":"One sentence, max 20 words, explaining what this activation pattern means for emotional/cognitive response. Be specific and slightly unsettling — expose manipulation."}}

Rules:
- Return exactly 3 regions
- activation values between 0.20 and 0.95
- Use real neuroscience region names (e.g. Amygdala, Anterior Cingulate Cortex, Broca's Area, Visual Cortex, Prefrontal Cortex, Insula, Temporal Pole, Fusiform Gyrus, Precuneus, Wernicke's Area, Orbitofrontal Cortex, Dorsolateral PFC, Ventromedial PFC, Superior Temporal Sulcus, Motor Cortex)
- function: 2-4 words describing what the region does
- interpretation must be unsettling/revealing about the tweet's psychological effect

Tweet: "{tweet_text}"
"""


class PredictRequest(BaseModel):
    tweet_text: str


class RegionResult(BaseModel):
    name: str
    activation: float
    function: str


class PredictResponse(BaseModel):
    regions: list[RegionResult]
    interpretation: str


def get_claude_client() -> anthropic.Anthropic:
    global claude_client
    if claude_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="ANTHROPIC_API_KEY not set",
            )
        claude_client = anthropic.Anthropic(api_key=api_key)
    return claude_client


def hash_text(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode()).hexdigest()[:16]


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    text = req.tweet_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty tweet text")
    if len(text) > 1000:
        text = text[:1000]

    cache_key = hash_text(text)

    cached = cache.get(cache_key)
    if cached:
        return PredictResponse(**cached)

    client = get_claude_client()

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[{
            "role": "user",
            "content": CLAUDE_PROMPT.format(tweet_text=text.replace('"', '\\"')),
        }],
    )

    content = response.content[0].text
    json_match = content
    if "{" in content:
        start = content.index("{")
        end = content.rindex("}") + 1
        json_match = content[start:end]

    result = json.loads(json_match)

    cache.set(cache_key, result, ttl=604800)

    return PredictResponse(**result)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
