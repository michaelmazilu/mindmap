"""
TRIBE v2 inference — real cortical predictions from tweet text.

Uses Meta's TribeModel (facebook/tribev2): text file → gTTS + word events →
neural forward pass → per-vertex activations on fsaverage5-scale outputs.

Requires GPU in production (Modal). Set HF_TOKEN / HUGGING_FACE_HUB_TOKEN for
gated LLaMA weights. Cache dir should be persistent (Modal Volume) to avoid
re-downloading checkpoints.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_model = None
_load_error: Optional[str] = None


def _ensure_hf_token() -> None:
    tok = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        or ""
    ).strip()
    if tok and not os.environ.get("HUGGING_FACE_HUB_TOKEN"):
        os.environ["HUGGING_FACE_HUB_TOKEN"] = tok


def get_cache_folder() -> str:
    return os.environ.get("TRIBE_CACHE_DIR", "/cache/tribe").strip() or "./tribe_cache"


def get_tribe_model():
    """Lazy-load TribeModel (thread-safe). Raises on failure."""
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error is not None:
        raise RuntimeError(_load_error)

    with _lock:
        if _model is not None:
            return _model
        _ensure_hf_token()
        cache = get_cache_folder()
        Path(cache).mkdir(parents=True, exist_ok=True)

        try:
            import torch
            from tribev2 import TribeModel
        except ImportError as e:
            _load_error = f"tribev2/torch not installed: {e}"
            logger.error(_load_error)
            raise RuntimeError(_load_error) from e

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if device == "cpu":
            logger.warning("TRIBE v2 on CPU will be very slow; use a GPU container")

        try:
            _model = TribeModel.from_pretrained(
                "facebook/tribev2",
                cache_folder=cache,
                device=device,
            )
        except Exception as e:
            _load_error = str(e)
            logger.exception("TribeModel.from_pretrained failed")
            raise RuntimeError(_load_error) from e

        logger.info("TribeModel loaded on %s", device)
        return _model


def predict_vertex_activations(text: str) -> np.ndarray:
    """
    Run TRIBE v2 on tweet-sized text.

    Returns:
        1D float array, mean over time segments, length = model cortical outputs.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty text")

    model = get_tribe_model()

    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".txt",
            delete=False,
            encoding="utf-8",
        ) as f:
            f.write(text[:4000])
            tmp_path = f.name

        events_df = model.get_events_dataframe(text_path=tmp_path)
        preds, _segments = model.predict(events=events_df, verbose=False)
        if preds.size == 0:
            raise RuntimeError("TRIBE v2 returned no prediction segments")
        mean_v = np.mean(preds, axis=0).astype(np.float32)
        return mean_v
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


def try_predict_vertex_activations(text: str) -> Optional[np.ndarray]:
    """Return activations or None if TRIBE is unavailable."""
    if os.environ.get("MINDMAP_DISABLE_TRIBE", "").lower() in ("1", "true", "yes"):
        return None
    try:
        return predict_vertex_activations(text)
    except Exception as e:
        logger.warning("TRIBE prediction failed: %s", e)
        return None
