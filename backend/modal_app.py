"""
Modal deployment configuration for Mindmap backend.

Deploy with:
    modal deploy modal_app.py

Test locally with:
    modal serve modal_app.py
"""

import modal

app = modal.App("mindmap-backend")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "anthropic",
        "numpy",
        "upstash-redis",
    )
    .add_local_file("main.py", "/app/main.py", copy=True)
    .add_local_file("cache.py", "/app/cache.py", copy=True)
    .add_local_file("atlas.py", "/app/atlas.py", copy=True)
    .add_local_file("claude_interpreter.py", "/app/claude_interpreter.py", copy=True)
    .add_local_file("tribe_runner.py", "/app/tribe_runner.py", copy=True)
    .add_local_file("tts.py", "/app/tts.py", copy=True)
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("mindmap-secrets")],
    cpu=1,
    memory=512,
    timeout=60,
)
@modal.asgi_app()
def fastapi_app():
    import sys
    sys.path.insert(0, "/app")
    from main import app as api
    return api
