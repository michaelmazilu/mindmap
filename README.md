# Mindmap — Brain Activation Visualizer for Twitter/X

**Repository:** [github.com/michaelmazilu/mindmap](https://github.com/michaelmazilu/mindmap)

A Chrome extension that shows which brain regions are predicted to activate when reading a tweet, rendered as a 3D brain heatmap directly in your Twitter/X feed.

<p align="center">
  <em>Medical equipment crossed with a hacker tool — exposing how tweets manipulate your brain.</em>
</p>

---

## How It Works (End-to-End)

### Extension → prediction source

1. **Content script** finds root tweets (replies are skipped), injects a **Mindmap** control under the action bar, and loads a **Three.js** brain when you expand the panel.
2. **Background service worker** receives `MINDMAP_PREDICT`, then chooses a source in this order:
   - **Hosted backend** — if `extension/background/config.local.js` defines `MINDMAP_HOSTED_ENDPOINT` *or* the popup **Overrides** field has a custom API URL (Modal URLs ending in `.modal.run`).
   - **Claude API** — if no hosted URL is set but an **API key** is saved in the popup.
   - **Local heuristic** — keyword-based regions + interpretation, no network (also used if the backend request fails).
3. The worker **caches** results in memory, **queues** concurrent requests (max 3 in flight), and applies a **120s timeout** to hosted `POST /predict` calls. On timeout or failure it falls back to the same in-browser heuristic and may prepend a short note to the interpretation.

### Hosted backend → model stack

When you point the extension at the FastAPI app (`POST /predict` with `{ "tweet_text": "..." }`), the server resolves predictions in this order:

1. **TRIBE v2** — text → vertex-level encoding predictions → **Destrieux** atlas rollup → top 3 named regions with activations. The stock interpretation names the strongest region and states that TRIBE v2 is an average-subject fMRI encoding model (not a clinical diagnosis).
2. **Claude** — if TRIBE fails or is unavailable, the server uses Anthropic with a JSON-only prompt (model chain: env `ANTHROPIC_MODEL` first, then discovered models, then built-in fallbacks).
3. **Heuristic** — `backend/heuristic.py` mirrors the idea of the extension’s lexicon: keyword scoring, seeded “random” activations, three regions + a punchy interpretation.

Responses are normalized to exactly **three regions** (`name`, `activation`, `function`) plus **`interpretation`**, then cached (Redis/Upstash when configured, else in-memory).

### What you see in the panel

| UI | Logic |
|----|--------|
| **3D brain heatmap** | Vertex colors blend toward red/orange/yellow by predicted activation; unknown API labels still map to plausible cortical locations via keyword rules + stable hash fallback (`brain-widget.js`). |
| **Mouse orbit + zoom** | **Drag** on the canvas orbits the camera around the brain; **scroll wheel** zooms (distance clamped). Slow automatic spin pauses while dragging. Tooltip: “Drag to orbit · scroll to zoom”. |
| **Top 3 regions** | Bars sorted by activation; **hover** highlights the matching blob on the brain. |
| **Likely felt emotion** | **Not** raw TRIBE output. The line prefers **tweet-text heuristics** (outrage, fear, hustle/dopamine, inadequacy bait, money cues, nostalgia, etc.). If nothing matches, it falls back to **region-name heuristics** (e.g. temporal Destrieux labels → *absorbed attention to language*, not “curiosity”). |
| **Ragebait detected** | Shown when **manipulative copy** is detected in the tweet text *or* when limbic/outrage-related **region or interpretation** strings match. Large, high-contrast styling. TRIBE often highlights **language cortex** for text-heavy posts, so text-based rules are required for this signal. |
| **Interpretation** | Quoted string from the API or heuristic (timeout path may include a server-timeout prefix). |

**Robustness:** WebGL/widget construction is wrapped so a GPU failure still allows predictions to render in the text UI. The brain is **disposed** when the panel collapses to reduce “too many WebGL contexts” on long timelines. **Extension context invalidated** after reload is handled with safe messaging and storage listeners.

---

## Quick Start

### 1. Install the Extension

```bash
git clone https://github.com/michaelmazilu/mindmap.git && cd mindmap
# No build step — vanilla JS
```

1. Open `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `mindmap/extension` folder
3. Open [x.com](https://x.com)

### 2. Configure the backend URL (recommended)

Do **not** commit secrets. Copy the example config (gitignored file):

```bash
cp extension/background/config.example.js extension/background/config.local.js
```

Set `self.MINDMAP_HOSTED_ENDPOINT` to your **`https://….modal.run`** URL (from `modal deploy`, not the `modal.com/apps/...` dashboard link). The service worker loads `config.local.js` via `importScripts` before handling requests.

Alternatively, set the same URL under **Overrides** in the extension popup.

### 3. Optional: Claude-only mode

Leave the hosted endpoint empty and paste an **Anthropic API key** in the popup. The worker calls `https://api.anthropic.com/v1/messages` directly with the same style of JSON region prediction.

### 4. Optional: Heuristic-only mode

No URL and no key → predictions use the **built-in lexicon** in `service-worker.js` (instant, offline).

### 5. Self-host / Modal backend

```bash
cd backend
pip install -r requirements.txt

export ANTHROPIC_API_KEY=sk-ant-...   # optional Claude fallback
# Optional: ANTHROPIC_MODEL=<model id> pins the first model tried
# Optional: UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN for shared cache

uvicorn main:app --host 0.0.0.0 --port 8000
```

**Modal:** see `modal_app.py`. Typical secret `mindmap-secrets` includes **`HF_TOKEN`** (TRIBE / LLaMA access) and optionally **`ANTHROPIC_API_KEY`**. Env knobs:

| Variable | Purpose |
|----------|---------|
| `MINDMAP_SKIP_TRIBE_PRELOAD` | Set to `1` / `true` to skip background TRIBE load at startup |
| `MINDMAP_ENABLE_DEBUG` | Set to `1` / `true` to enable `GET /debug` (Anthropic key/model smoke tests) |
| `MINDMAP_MODAL_MIN_CONTAINERS` | Modal `min_containers` (default `0`; `1` keeps GPU warm) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ X / Twitter DOM                                                  │
│   content.js  →  MindmapBrainWidget (Three.js) + bars + emotion  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ chrome.runtime.sendMessage
┌───────────────────────────▼─────────────────────────────────────┐
│ service-worker.js                                                │
│   Hosted fetch (120s timeout) → Claude direct → predictHeuristic │
│   In-memory cache · request queue (max 3 concurrent)             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS POST /predict (when configured)
┌───────────────────────────▼─────────────────────────────────────┐
│ FastAPI main.py                                                  │
│   TRIBE v2 → atlas Destrieux top-3 → Claude → heuristic.py       │
│   cache.py · optional Upstash                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
mindmap/
├── extension/
│   ├── manifest.json
│   ├── background/
│   │   ├── service-worker.js       # predict routing, timeout, heuristic, cache
│   │   ├── config.example.js       # copy → config.local.js (gitignored)
│   │   └── config.local.js         # MINDMAP_HOSTED_ENDPOINT (do not commit)
│   ├── content/
│   │   ├── content.js              # tweet injection, emotion/ragebait heuristics
│   │   ├── brain-widget.js         # Three.js scene, orbit/zoom, activation paint
│   │   └── content.css
│   ├── popup/
│   ├── lib/
│   │   └── three.min.js
│   └── assets/
│
├── backend/
│   ├── main.py                     # /predict, /health, gated /debug, lifespan preload
│   ├── tribe_runner.py             # TRIBE v2 inference
│   ├── atlas.py                    # Surface → Destrieux region rollup
│   ├── heuristic.py                # Server-side keyword fallback
│   ├── cache.py
│   ├── tts.py                      # Edge TTS (optional / future audio path)
│   ├── claude_interpreter.py       # Bundled on Modal; optional / future use
│   ├── modal_app.py
│   ├── tests/
│   └── requirements.txt
│
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Extension | Manifest V3, vanilla JS, Three.js |
| Visualization | Procedural brain mesh, vertex-color heatmap, pointer orbit + wheel zoom |
| Service worker | Fetch + AbortController, in-memory cache, local heuristic engine |
| Backend | FastAPI, TRIBE v2, Destrieux atlas, optional Anthropic, heuristic fallback |
| Hosting | Modal (GPU), optional Upstash Redis |

---

## Extension Settings (popup)

| Setting | Description |
|---------|-------------|
| Enable / disable | Global Mindmap toggle |
| Auto-expand | Open brain panels without clicking the trigger |
| Activation threshold | Slider persisted in storage *(visibility gating in the content script is not wired yet)* |
| API key | Claude when no hosted URL |
| Custom endpoint | Overrides default Modal URL from `config.local.js` |

---

## Design

Dark background (`#08080a`), clinical precision, warm activation colors.

- **Fonts:** JetBrains Mono (data) + Inter (UI)
- **Heatmap:** `#8b0000` → `#ff4500` → `#ffdd00`
- **Brain:** Low-poly icosahedron with gyral deformation; wireframe accent

---

## Roadmap

- [x] Chrome extension + Three.js brain
- [x] Hosted FastAPI + **TRIBE v2** + Destrieux top regions
- [x] Claude + **server-side heuristic** fallback
- [x] Extension **local heuristic** + **backend timeout** fallback
- [x] **Likely felt emotion** + **ragebait** heuristics (tweet text + regions)
- [x] **Orbit / zoom** brain interaction
- [x] Region **hover highlight** on brain
- [x] WebGL **dispose** on collapse; safer reload / invalid-context handling
- [x] Gated **`/debug`** for production
- [ ] Apply **activation threshold** to when the widget appears
- [ ] Real fsaverage mesh (GLTF) aligned to atlas
- [ ] Redis caching via Upstash in common deploys
- [ ] Firefox / Safari ports

---

## License

MIT
