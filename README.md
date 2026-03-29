# Mindmap — Brain Activation Visualizer for Twitter/X

**Repository:** [github.com/michaelmazilu/mindmap](https://github.com/michaelmazilu/mindmap)

A Chrome extension that shows which brain regions are predicted to activate when reading a tweet, rendered as a 3D brain heatmap directly in your Twitter feed.

<p align="center">
  <em>Medical equipment crossed with a hacker tool — exposing how tweets manipulate your brain.</em>
</p>

---

## How It Works

```
Tweet text
  → Claude API predicts which brain regions activate
  → Three.js renders a 3D brain with glowing heatmap regions
  → Plain-English interpretation explains the manipulation
```

Each tweet gets a collapsible panel showing:
- **3D rotating brain** with red/orange/yellow activation heatmap
- **Top 3 regions** with activation bars (e.g. "Amygdala 82%")
- **One-line interpretation** (e.g. *"This tweet hijacks your threat-detection circuits to manufacture outrage."*)

## Quick Start

### 1. Install the Extension

```bash
# Clone the repo
git clone https://github.com/michaelmazilu/mindmap.git && cd mindmap

# No build step needed — it's vanilla JS
```

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `mindmap/extension` folder
4. Navigate to [x.com](https://x.com)

### 2. Backend (default)

The extension ships with a default Modal API URL in `extension/background/service-worker.js` (`HOSTED_ENDPOINT`). After `modal deploy`, confirm that URL matches the **HTTPS endpoint** Modal prints (it ends in `.modal.run`, not `modal.com/apps/...`).

Optional: open the extension popup → **Overrides** to set another backend URL or a Claude API key for direct calls.

### 3. (Optional) Self-Host the Backend

For the full TRIBE v2 pipeline or to avoid client-side API keys:

```bash
cd backend
pip install -r requirements.txt

# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export UPSTASH_REDIS_URL=https://...    # optional
export UPSTASH_REDIS_TOKEN=...          # optional

# Run locally
uvicorn main:app --host 0.0.0.0 --port 8000

# Or deploy to Modal
modal deploy modal_app.py
```

Then set the backend URL under **Overrides** in the extension popup (or change `HOSTED_ENDPOINT` in the service worker).

## Architecture

### MVP (Current)

The extension calls Claude directly from the background service worker to predict brain region activations. No backend server needed.

```
Content Script → Background Worker → Claude API → Three.js visualization
```

### Production Pipeline (Planned)

```
Tweet → Edge TTS → TRIBE v2 model → fsaverage activations → Atlas lookup → Claude interpretation
```

Swap in the real ML pipeline by deploying the backend and pointing the extension to it.

## File Structure

```
mindmap/
├── extension/
│   ├── manifest.json              # Manifest V3 Chrome extension config
│   ├── content/
│   │   ├── content.js             # Tweet detection (MutationObserver)
│   │   ├── brain-widget.js        # Three.js brain renderer
│   │   └── content.css            # Widget styling
│   ├── background/
│   │   └── service-worker.js      # API calls, caching, rate limiting
│   ├── popup/
│   │   ├── popup.html             # Settings panel
│   │   └── popup.js               # Settings logic
│   ├── lib/
│   │   └── three.min.js           # Three.js r128
│   └── assets/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
├── backend/
│   ├── main.py                    # FastAPI server
│   ├── cache.py                   # Redis/Upstash + in-memory cache
│   ├── atlas.py                   # Brain region atlas lookup
│   ├── tribe_runner.py            # TRIBE v2 wrapper (stub for MVP)
│   ├── tts.py                     # Edge TTS for audio generation
│   ├── claude_interpreter.py      # Plain-English interpretation
│   ├── modal_app.py               # Modal deployment config
│   └── requirements.txt
│
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Manifest V3, vanilla JS, Three.js |
| Visualization | Procedural brain mesh, vertex color heatmap |
| MVP Backend | Claude API (direct from extension) |
| Production Backend | FastAPI, TRIBE v2, Edge TTS, Destrieux atlas |
| Hosting | Modal (serverless GPU), Upstash Redis |

## Extension Settings

| Setting | Description |
|---------|-------------|
| Enable/Disable | Toggle Mindmap globally |
| Auto-expand | Show brain panels without clicking |
| Activation threshold | Only show widget above N% activation |
| API Key | Claude API key for MVP mode |
| Custom endpoint | Point to self-hosted backend |

## Design

Dark background (`#08080a`), clinical precision, warm glowing activations. The brain visualization is the star — everything else recedes.

- **Fonts**: JetBrains Mono (numbers) + Inter (labels)
- **Heatmap**: `#8b0000` → `#ff4500` → `#ffdd00` gradient
- **Brain mesh**: Low-poly icosahedron with gyri/sulci deformations

## Roadmap

- [x] Chrome extension with Three.js brain visualization
- [x] Claude-powered MVP predictions
- [x] Settings popup with API key management
- [x] In-memory caching + rate limiting
- [ ] TRIBE v2 model integration
- [ ] Real fsaverage brain mesh (GLTF)
- [ ] Redis caching via Upstash
- [ ] Firefox/Safari extension ports
- [ ] Brain region click-to-highlight interaction
- [ ] Activation history / tweet comparison view

## License

MIT
