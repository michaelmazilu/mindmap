"""
Modal deployment configuration for Mindmap backend (FastAPI + TRIBE v2 on GPU).

Deploy with:
    modal deploy modal_app.py

Requires Modal secret `mindmap-secrets` with at least:
  - HF_TOKEN (Hugging Face read token; LLaMA 3.2 access required for tribev2)
  - Optional: ANTHROPIC_API_KEY (Claude fallback)

First deploy creates volume `mindmap-tribe-cache` for model + HF caches.
"""

import os

import modal

app = modal.App("mindmap-backend")

tribe_volume = modal.Volume.from_name("mindmap-tribe-cache", create_if_missing=True)

# 0 = scale to zero when idle (cheapest; first request after idle pays cold start + model load).
# 1 = keep one GPU container warm 24/7 (much lower p95 latency, ~continuous GPU billing).
_MIN_CONTAINERS = int(os.environ.get("MINDMAP_MODAL_MIN_CONTAINERS", "0"))

# TRIBE v2: install CUDA PyTorch first, then the repo, then force GPU torch again.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "git",
        "ffmpeg",
        "libsndfile1",
        "curl",
        "ca-certificates",
    )
    .pip_install(
        "fastapi[standard]>=0.115.0",
        "anthropic>=0.42.0",
        "upstash-redis>=1.1.0",
        "nilearn>=0.10.0",
    )
    .run_commands(
        "pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124",
        "pip install git+https://github.com/facebookresearch/tribev2.git",
        "pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124 --force-reinstall",
        "python -m spacy download en_core_web_sm",
    )
    .env(
        {
            "TRIBE_CACHE_DIR": "/cache/tribe",
            "HF_HOME": "/cache/hf",
            "TRANSFORMERS_CACHE": "/cache/hf",
            "TORCH_HOME": "/cache/torch",
        }
    )
    .add_local_file("main.py", "/app/main.py", copy=True)
    .add_local_file("cache.py", "/app/cache.py", copy=True)
    .add_local_file("atlas.py", "/app/atlas.py", copy=True)
    .add_local_file("heuristic.py", "/app/heuristic.py", copy=True)
    .add_local_file("claude_interpreter.py", "/app/claude_interpreter.py", copy=True)
    .add_local_file("tribe_runner.py", "/app/tribe_runner.py", copy=True)
    .add_local_file("tts.py", "/app/tts.py", copy=True)
)


@app.function(
    image=image,
    gpu="T4",
    secrets=[modal.Secret.from_name("mindmap-secrets")],
    volumes={"/cache": tribe_volume},
    cpu=4,
    memory=24576,
    timeout=900,
    # Stay warm longer so casual scrolling hits a loaded container (saves cold GPU spin-up).
    scaledown_window=60 * 45,
    min_containers=_MIN_CONTAINERS,
)
@modal.asgi_app()
def fastapi_app():
    import sys

    sys.path.insert(0, "/app")
    from main import app as api

    return api
