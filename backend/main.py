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
from heuristic import predict_heuristic

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

# Tried in order until one succeeds. Set ANTHROPIC_MODEL to pin a single model (tried first).
_MODEL_CHAIN_DEFAULT = [
    "claude-3-5-haiku-20241022",
    "claude-3-5-sonnet-20241022",
    "claude-3-haiku-20240307",
    "claude-sonnet-4-20250514",
]


def _sanitize_api_key(raw: Optional[str]) -> str:
    """Modal/CLI secrets often include trailing newlines or quotes."""
    if not raw:
        return ""
    k = raw.strip()
    if len(k) >= 2 and k[0] == k[-1] and k[0] in "\"'":
        k = k[1:-1].strip()
    k = k.replace("\r", "").replace("\n", "").strip()
    return k


def _discover_model_ids(client: anthropic.Anthropic) -> list[str]:
    """Use Anthropic's model list so we only try IDs your key actually has."""
    try:
        page = client.models.list(limit=100)
        ids: list[str] = []
        for item in page.data:
            mid = getattr(item, "id", None)
            if isinstance(mid, str) and mid.startswith("claude-"):
                ids.append(mid)

        def rank(m: str) -> tuple:
            ml = m.lower()
            if "haiku" in ml:
                return (0, m)
            if "sonnet" in ml:
                return (1, m)
            if "opus" in ml:
                return (2, m)
            return (3, m)

        ids.sort(key=rank)
        if ids:
            logger.info("Discovered %s Claude model(s) for this key", len(ids))
        return ids
    except anthropic.APIStatusError as e:
        logger.warning("models.list failed HTTP %s: %s", e.status_code, e.message)
        return []
    except Exception as e:
        logger.warning("models.list failed: %s", e)
        return []


def _model_candidates(client: anthropic.Anthropic) -> list[str]:
    discovered = _discover_model_ids(client)
    env = os.environ.get("ANTHROPIC_MODEL", "").strip()
    seen: set[str] = set()
    out: list[str] = []
    if env:
        out.append(env)
        seen.add(env)
    for m in discovered:
        if m not in seen:
            out.append(m)
            seen.add(m)
    for m in _MODEL_CHAIN_DEFAULT:
        if m not in seen:
            out.append(m)
            seen.add(m)
    return out

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
        api_key = _sanitize_api_key(os.environ.get("ANTHROPIC_API_KEY"))
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


def _try_claude(text: str, cache_key: str) -> Optional[dict]:
    """Attempt Claude prediction. Returns normalized dict or None on failure."""
    try:
        client = get_claude_client()
    except HTTPException:
        logger.info("No Claude API key configured — using heuristic")
        return None

    prompt = CLAUDE_PROMPT_TEMPLATE.replace(
        "__TWEET_BODY__",
        json.dumps(text, ensure_ascii=False),
    )

    def _create(model_id: str):
        return client.messages.create(
            model=model_id,
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        )

    response = None
    candidates = _model_candidates(client)

    for model_id in candidates:
        try:
            response = _create(model_id)
            break
        except anthropic.APIStatusError as e:
            if e.status_code in (400, 401, 403, 404, 429):
                logger.warning(
                    "Anthropic %s for model=%s: %s",
                    e.status_code, model_id,
                    getattr(e, "message", str(e))[:200],
                )
                continue
            logger.exception("Anthropic API error %s", e.status_code)
            return None
        except Exception:
            logger.exception("Claude call failed")
            return None

    if response is None:
        return None

    try:
        raw_text = extract_text_from_message(response)
    except HTTPException:
        return None

    try:
        parsed = parse_prediction_json(raw_text)
        return normalize_prediction(parsed)
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("Bad JSON from Claude: %s", e)
        return None


def _try_tribe(text: str) -> Optional[dict]:
    """Run TRIBE v2 + surface atlas. Returns normalized dict or None."""
    from atlas import surf_destrieux_top_regions
    from tribe_runner import try_predict_vertex_activations

    verts = try_predict_vertex_activations(text)
    if verts is None:
        return None
    try:
        regions = surf_destrieux_top_regions(verts, n=3)
    except Exception as e:
        logger.warning("Atlas mapping failed: %s", e)
        return None
    if not regions:
        return None
    r0 = regions[0]["name"]
    interp = (
        f"TRIBE v2 predicts the strongest cortical response in {r0} "
        f"when reading this (average-subject fMRI encoding model)."
    )
    return normalize_prediction({
        "regions": regions,
        "interpretation": interp,
    })


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

    normalized = _try_tribe(text)
    source = "tribe_v2"

    if normalized is None:
        normalized = _try_claude(text, cache_key)
        source = "claude"

    if normalized is None:
        logger.info("TRIBE/Claude unavailable — heuristic engine")
        normalized = normalize_prediction(predict_heuristic(text))
        source = "heuristic"

    out = PredictResponse(**normalized)
    cache.set(cache_key, normalized, ttl=604800)
    logger.info("Prediction served via %s for hash=%s", source, cache_key)
    return out


@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/debug")
async def debug():
    """Diagnostic endpoint — shows exactly what Anthropic says about this key."""
    results: dict[str, Any] = {"key_prefix": "", "models": [], "test_calls": []}

    api_key = _sanitize_api_key(os.environ.get("ANTHROPIC_API_KEY"))
    if not api_key:
        return {"error": "ANTHROPIC_API_KEY env var is empty or missing"}

    results["key_prefix"] = api_key[:12] + "..." + api_key[-4:]
    results["key_length"] = len(api_key)

    client = anthropic.Anthropic(api_key=api_key)

    try:
        page = client.models.list(limit=20)
        results["models"] = [
            {"id": getattr(m, "id", "?"), "name": getattr(m, "display_name", "?")}
            for m in page.data
        ]
    except Exception as e:
        results["models_error"] = f"{type(e).__name__}: {e}"

    for model_id in _model_candidates(client)[:4]:
        entry: dict[str, Any] = {"model": model_id}
        try:
            resp = client.messages.create(
                model=model_id,
                max_tokens=32,
                messages=[{"role": "user", "content": [{"type": "text", "text": "Say hi"}]}],
            )
            entry["status"] = "ok"
            entry["response"] = resp.content[0].text if resp.content else "empty"
        except anthropic.APIStatusError as e:
            entry["status"] = "error"
            entry["code"] = e.status_code
            entry["body"] = str(e.body)[:500] if hasattr(e, "body") else None
            entry["message"] = str(e.message)[:500]
        except Exception as e:
            entry["status"] = "error"
            entry["message"] = f"{type(e).__name__}: {e}"
        results["test_calls"].append(entry)
        if entry.get("status") == "ok":
            break

    return results
