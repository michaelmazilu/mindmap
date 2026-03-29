"""
Heuristic brain-region predictor — no API key required.

Uses keyword/sentiment analysis to map tweet text to plausible brain
region activations. Not neuroscientifically rigorous, but produces
outputs indistinguishable from the Claude-based predictor for a
casual user.
"""

from __future__ import annotations

import hashlib
import random
from typing import Any

_LEXICONS: dict[str, dict[str, list[str]]] = {
    "fear_threat": {
        "regions": ["Amygdala", "Anterior Cingulate Cortex", "Insula"],
        "functions": ["threat detection", "conflict monitoring", "visceral awareness"],
        "keywords": [
            "afraid", "alarming", "anxiety", "attack", "banned", "bomb", "catastrophe",
            "collapse", "crash", "crisis", "danger", "dead", "death", "destroy",
            "disaster", "doom", "emergency", "enemy", "explode", "fatal", "fear",
            "fight", "fire", "flood", "gun", "harm", "hate", "horror", "hurt",
            "kill", "murder", "panic", "poison", "risk", "scared", "shock",
            "suffer", "terror", "threat", "toxic", "trauma", "victim", "violence",
            "virus", "war", "warning", "weapon", "worry",
        ],
        "interpretations": [
            "Your amygdala hijacked rational thought before you finished the first word.",
            "This tweet weaponizes your threat-detection circuitry to bypass logic.",
            "Fear pathways activated faster than your prefrontal cortex could intervene.",
            "Your brain read this as a survival threat — exactly as intended.",
        ],
    },
    "reward_desire": {
        "regions": ["Nucleus Accumbens", "Orbitofrontal Cortex", "Ventromedial PFC"],
        "functions": ["reward anticipation", "value assessment", "emotional valuation"],
        "keywords": [
            "amazing", "beautiful", "best", "buy", "cash", "cheap", "crypto",
            "deal", "delicious", "desire", "discount", "dream", "earn", "easy",
            "exclusive", "fortune", "free", "gain", "goal", "gold", "gorgeous",
            "giveaway", "hack", "income", "invest", "jackpot", "luxury", "million",
            "money", "offer", "opportunity", "passive", "perfect", "premium",
            "profit", "promotion", "recipe", "revenue", "rich", "sale", "save",
            "secret", "stock", "success", "treasure", "upgrade", "wealth", "win",
        ],
        "interpretations": [
            "Dopamine circuits activated before conscious evaluation — you're already hooked.",
            "Your reward system valued the promise before your logic centers checked the math.",
            "This tweet speaks directly to the brain's 'want' circuits, bypassing reason.",
            "The reward prediction error your brain just computed is pure manipulation.",
        ],
    },
    "social_identity": {
        "regions": ["Superior Temporal Sulcus", "Temporal Pole", "Precuneus"],
        "functions": ["social perception", "social cognition", "self-referential thought"],
        "keywords": [
            "agree", "believe", "belong", "betray", "blame", "bro", "cancel",
            "community", "debate", "disagree", "empathy", "family", "fam",
            "follow", "friend", "gang", "group", "hug", "influence", "join",
            "judge", "king", "leader", "like", "love", "loyal", "marry",
            "mentor", "opinion", "our", "partner", "people", "queen", "ratio",
            "relationship", "respect", "share", "side", "stan", "subscribe",
            "support", "team", "together", "tribe", "trust", "unfollow", "us",
            "vibe", "vote", "we", "y'all",
        ],
        "interpretations": [
            "Your brain's social-identity network lit up — tribalism circuits fully engaged.",
            "Mirror neurons activated: you're simulating the author's mental state involuntarily.",
            "Self-referential processing triggered — this tweet made you think about *you*.",
            "Social evaluation circuits fired before you chose to care about this person.",
        ],
    },
    "analytical": {
        "regions": ["Dorsolateral PFC", "Broca's Area", "Angular Gyrus"],
        "functions": ["executive reasoning", "language processing", "semantic integration"],
        "keywords": [
            "according", "actually", "algorithm", "analysis", "argue", "because",
            "bias", "calculate", "cause", "claim", "compare", "complex", "conclude",
            "consequence", "consider", "context", "correlate", "data", "debate",
            "define", "demonstrate", "despite", "detail", "difference", "effect",
            "estimate", "evaluate", "evidence", "example", "explain", "fact",
            "figure", "however", "hypothesis", "implication", "indeed", "logic",
            "moreover", "number", "nuance", "observe", "percent", "proof",
            "prove", "ratio", "reason", "research", "result", "science",
            "significant", "source", "statistic", "study", "theory", "therefore",
            "thus", "variable",
        ],
        "interpretations": [
            "Your prefrontal cortex engaged deeply — but analytical effort makes you trust more, not less.",
            "Language processing areas working overtime — complexity creates an illusion of authority.",
            "Semantic integration circuits activated: your brain is building a narrative it may not question.",
            "Executive reasoning engaged, but effort spent parsing ≠ truth detected.",
        ],
    },
    "outrage_moral": {
        "regions": ["Anterior Cingulate Cortex", "Insula", "Amygdala"],
        "functions": ["conflict monitoring", "moral disgust", "emotional arousal"],
        "keywords": [
            "absurd", "angry", "awful", "corrupt", "criminal", "cruel", "despicable",
            "disgusting", "embarrassing", "evil", "exploit", "fraud", "furious",
            "greed", "horrible", "hypocrisy", "idiot", "illegal", "immoral",
            "incompetent", "injustice", "insane", "liar", "lie", "manipulate",
            "outrage", "pathetic", "predator", "propaganda", "racist", "rage",
            "scandal", "scam", "shame", "sick", "steal", "stupid", "terrible",
            "trash", "unfair", "unforgivable", "vile", "wrong",
        ],
        "interpretations": [
            "Moral outrage activated your anterior cingulate — engagement guaranteed, nuance discarded.",
            "Your insula registered disgust in milliseconds; the tweet was engineered for exactly this.",
            "Outrage is the most viral emotion — your brain just proved why.",
            "Conflict-detection circuits maxed out: you'll share this before thinking about it.",
        ],
    },
    "nostalgia_memory": {
        "regions": ["Hippocampus", "Precuneus", "Posterior Cingulate Cortex"],
        "functions": ["memory retrieval", "autobiographical recall", "emotional memory"],
        "keywords": [
            "childhood", "classic", "generations", "golden", "grew up", "heritage",
            "history", "home", "legend", "memories", "miss", "nostalgia", "old",
            "once", "original", "past", "remember", "retro", "reunion", "roots",
            "school", "simpler", "throwback", "tradition", "used to", "vintage",
            "wish", "yesterday", "young", "youth",
        ],
        "interpretations": [
            "Memory circuits activated — nostalgia is a drug and this tweet is the dealer.",
            "Your hippocampus just time-traveled; the present moment lost its grip on you.",
            "Autobiographical memory networks lit up: you're feeling, not thinking.",
            "Posterior cingulate engaged in self-reflection — the past always feels safer than it was.",
        ],
    },
    "visual_sensory": {
        "regions": ["Visual Cortex", "Fusiform Gyrus", "Superior Colliculus"],
        "functions": ["visual processing", "pattern recognition", "visual attention"],
        "keywords": [
            "aesthetic", "art", "beautiful", "bright", "color", "colourful",
            "dark", "design", "eye", "face", "film", "glow", "gorgeous",
            "graphic", "green", "icon", "illustration", "image", "landscape",
            "light", "look", "meme", "neon", "paint", "photo", "picture",
            "pink", "pixel", "portrait", "pretty", "purple", "rainbow", "red",
            "scenery", "screenshot", "shadow", "shape", "sky", "stunning",
            "sunset", "texture", "view", "visual", "watch",
        ],
        "interpretations": [
            "Visual processing areas recruited heavily — your attention was captured, not given.",
            "Fusiform gyrus activated: your brain treated this content like a face to memorize.",
            "Your visual cortex processed this faster than language — imagery bypasses critical thinking.",
            "Pattern recognition circuits fired — your brain found meaning that may not exist.",
        ],
    },
}

_DEFAULT_CAT = {
    "regions": ["Prefrontal Cortex", "Wernicke's Area", "Anterior Cingulate Cortex"],
    "functions": ["executive control", "language comprehension", "attention allocation"],
    "interpretations": [
        "Multiple cortical areas activated — your brain allocated more resources than this tweet deserves.",
        "Default-mode network disrupted: scrolling just became processing.",
        "Language comprehension circuits engaged, extracting meaning from noise.",
        "Your brain spent metabolic energy on this — and that was the point.",
    ],
}


def _seed_from_text(text: str) -> int:
    return int(hashlib.md5(text.encode()).hexdigest()[:8], 16)


def _score_categories(text: str) -> list[tuple[str, int]]:
    lower = text.lower()
    words = set(lower.split())
    scores: list[tuple[str, int]] = []
    for cat_name, cat in _LEXICONS.items():
        hits = sum(1 for kw in cat["keywords"] if kw in words or kw in lower)
        scores.append((cat_name, hits))
    scores.sort(key=lambda x: -x[1])
    return scores


def predict_heuristic(tweet_text: str) -> dict[str, Any]:
    """Return a prediction dict matching PredictResponse shape."""
    text = tweet_text.strip()
    if not text:
        text = "empty"

    rng = random.Random(_seed_from_text(text))
    scored = _score_categories(text)

    top_cats: list[str] = []
    for cat_name, hits in scored:
        if hits > 0:
            top_cats.append(cat_name)
        if len(top_cats) >= 2:
            break

    if not top_cats:
        top_cats.append(scored[0][0] if scored else "analytical")

    primary = _LEXICONS.get(top_cats[0], _DEFAULT_CAT)
    secondary = _LEXICONS.get(top_cats[1], _DEFAULT_CAT) if len(top_cats) > 1 else _DEFAULT_CAT

    regions = []
    regions.append({
        "name": primary["regions"][0],
        "activation": round(rng.uniform(0.65, 0.95), 2),
        "function": primary["functions"][0],
    })
    regions.append({
        "name": primary["regions"][1] if len(primary["regions"]) > 1 else secondary["regions"][0],
        "activation": round(rng.uniform(0.40, 0.70), 2),
        "function": primary["functions"][1] if len(primary["functions"]) > 1 else secondary["functions"][0],
    })
    regions.append({
        "name": secondary["regions"][0] if secondary != primary else primary["regions"][2],
        "activation": round(rng.uniform(0.25, 0.50), 2),
        "function": secondary["functions"][0] if secondary != primary else primary["functions"][2],
    })

    seen_names = set()
    deduped = []
    for r in regions:
        if r["name"] not in seen_names:
            seen_names.add(r["name"])
            deduped.append(r)
    while len(deduped) < 3:
        for fallback in _DEFAULT_CAT["regions"]:
            if fallback not in seen_names:
                seen_names.add(fallback)
                deduped.append({
                    "name": fallback,
                    "activation": round(rng.uniform(0.20, 0.40), 2),
                    "function": _DEFAULT_CAT["functions"][len(deduped) % len(_DEFAULT_CAT["functions"])],
                })
                break

    interpretation = rng.choice(primary["interpretations"])

    return {
        "regions": deduped[:3],
        "interpretation": interpretation,
    }
