// Optional: `config.local.js` (gitignored) sets self.MINDMAP_HOSTED_ENDPOINT — see config.example.js
try {
  importScripts('config.local.js');
} catch (e) {
  /* missing config.local.js is OK — use popup Overrides or heuristic-only */
}

const MAX_CONCURRENT = 3;
let inflightCount = 0;
const requestQueue = [];
const memoryCache = new Map();

// Modal + TRIBE cold start can exceed 2m; beyond this we fall back to local heuristic so the UI never spins forever.
const BACKEND_FETCH_TIMEOUT_MS = 120000;

const HOSTED_ENDPOINT =
  typeof self.MINDMAP_HOSTED_ENDPOINT === 'string' && self.MINDMAP_HOSTED_ENDPOINT.trim()
    ? self.MINDMAP_HOSTED_ENDPOINT.trim()
    : '';

const DEFAULT_SETTINGS = {
  enabled: true,
  autoExpand: false,
  threshold: 0,
  apiEndpoint: '',
  apiKey: '',
};

async function getSettings() {
  const result = await chrome.storage.sync.get('mindmap_settings');
  return { ...DEFAULT_SETTINGS, ...(result.mindmap_settings || {}) };
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return 'nx_' + Math.abs(hash).toString(36);
}

async function callClaudeMVP(tweetText, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are a neuroscience prediction engine. Analyze this tweet and predict which brain regions would activate most strongly when reading it. Return ONLY valid JSON, no other text.

Format:
{"regions":[{"name":"REGION_NAME","activation":0.XX,"function":"brief function description"}],"interpretation":"One sentence, max 20 words, explaining what this activation pattern means for emotional/cognitive response. Be specific and slightly unsettling — expose manipulation."}

Rules:
- Return exactly 3 regions
- activation values between 0.20 and 0.95
- Use real neuroscience region names (e.g. Amygdala, Anterior Cingulate Cortex, Broca's Area, Visual Cortex, Prefrontal Cortex, Insula, Temporal Pole, Fusiform Gyrus, Precuneus, Wernicke's Area, Orbitofrontal Cortex, Dorsolateral PFC, Ventromedial PFC, Superior Temporal Sulcus, Motor Cortex)
- function: 2-4 words describing what the region does
- interpretation must be unsettling/revealing about the tweet's psychological effect

Tweet: "${tweetText.replace(/"/g, '\\"').slice(0, 500)}"`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]);
}

function normalizePredictUrl(endpoint) {
  const base = endpoint.replace(/\/$/, '');
  return base.endsWith('/predict') ? base : `${base}/predict`;
}

async function callCustomBackend(tweetText, endpoint) {
  if (!endpoint || endpoint.includes('your-username')) {
    throw new Error(
      'Backend URL not set. Copy extension/background/config.example.js to config.local.js, or set API endpoint in the popup Overrides.',
    );
  }
  if (endpoint.includes('modal.com/apps')) {
    throw new Error(
      'That is the Modal dashboard URL. Use the API host ending in .modal.run (shown after modal deploy).',
    );
  }

  const url = normalizePredictUrl(endpoint);
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), BACKEND_FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet_text: tweetText }),
      signal: ac.signal,
    });
  } catch (e) {
    const name = e && e.name;
    if (name === 'AbortError') {
      throw new Error(
        'BACKEND_TIMEOUT: Server took too long (cold GPU / TRIBE / VPN). Showing offline estimate.',
      );
    }
    throw new Error(
      'Cannot reach backend (network/VPN?). Confirm the Modal URL, try without VPN, reload the extension.',
    );
  } finally {
    clearTimeout(tid);
  }

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Backend error ${response.status}${err ? `: ${err.slice(0, 120)}` : ''}`);
  }
  return await response.json();
}

// --------------- Local heuristic engine (no API needed) ---------------

const _LEXICONS = {
  fear_threat: {
    regions: ['Amygdala', 'Anterior Cingulate Cortex', 'Insula'],
    functions: ['threat detection', 'conflict monitoring', 'visceral awareness'],
    keywords: 'afraid alarming anxiety attack banned bomb catastrophe collapse crash crisis danger dead death destroy disaster doom emergency enemy explode fatal fear fight fire flood gun harm hate horror hurt kill murder panic poison risk scared shock suffer terror threat toxic trauma victim violence virus war warning weapon worry'.split(' '),
    interpretations: [
      'Your amygdala hijacked rational thought before you finished the first word.',
      'This tweet weaponizes your threat-detection circuitry to bypass logic.',
      'Fear pathways activated faster than your prefrontal cortex could intervene.',
    ],
  },
  reward_desire: {
    regions: ['Nucleus Accumbens', 'Orbitofrontal Cortex', 'Ventromedial PFC'],
    functions: ['reward anticipation', 'value assessment', 'emotional valuation'],
    keywords: 'amazing beautiful best buy cash cheap crypto deal delicious desire discount dream earn easy exclusive fortune free gain goal gold gorgeous giveaway hack income invest jackpot luxury million money offer opportunity passive perfect premium profit promotion revenue rich sale save secret stock success treasure upgrade wealth win'.split(' '),
    interpretations: [
      'Dopamine circuits activated before conscious evaluation — you\'re already hooked.',
      'Your reward system valued the promise before your logic centers checked the math.',
      'This tweet speaks directly to the brain\'s want circuits, bypassing reason.',
    ],
  },
  social_identity: {
    regions: ['Superior Temporal Sulcus', 'Temporal Pole', 'Precuneus'],
    functions: ['social perception', 'social cognition', 'self-referential thought'],
    keywords: 'agree believe belong betray blame bro cancel community debate disagree empathy family fam follow friend gang group hug influence join judge king leader like love loyal marry mentor opinion our partner people queen ratio relationship respect share side stan subscribe support team together tribe trust unfollow us vibe vote we'.split(' '),
    interpretations: [
      'Your brain\'s social-identity network lit up — tribalism circuits fully engaged.',
      'Mirror neurons activated: you\'re simulating the author\'s mental state involuntarily.',
      'Self-referential processing triggered — this tweet made you think about *you*.',
    ],
  },
  analytical: {
    regions: ['Dorsolateral PFC', "Broca's Area", 'Angular Gyrus'],
    functions: ['executive reasoning', 'language processing', 'semantic integration'],
    keywords: 'according actually algorithm analysis argue because bias calculate cause claim compare complex conclude consequence consider context correlate data debate define demonstrate despite detail difference effect estimate evaluate evidence example explain fact figure however hypothesis implication indeed logic moreover number nuance observe percent proof prove ratio reason research result science significant source statistic study theory therefore thus variable'.split(' '),
    interpretations: [
      'Your prefrontal cortex engaged deeply — but analytical effort makes you trust more, not less.',
      'Language processing areas working overtime — complexity creates an illusion of authority.',
      'Semantic integration circuits activated: your brain is building a narrative it may not question.',
    ],
  },
  outrage_moral: {
    regions: ['Anterior Cingulate Cortex', 'Insula', 'Amygdala'],
    functions: ['conflict monitoring', 'moral disgust', 'emotional arousal'],
    keywords: 'absurd angry awful corrupt criminal cruel despicable disgusting embarrassing evil exploit fraud furious greed horrible hypocrisy idiot illegal immoral incompetent injustice insane liar lie manipulate outrage pathetic predator propaganda racist rage scandal scam shame sick steal stupid terrible trash unfair unforgivable vile wrong'.split(' '),
    interpretations: [
      'Moral outrage activated your anterior cingulate — engagement guaranteed, nuance discarded.',
      'Your insula registered disgust in milliseconds; the tweet was engineered for exactly this.',
      'Outrage is the most viral emotion — your brain just proved why.',
    ],
  },
  nostalgia_memory: {
    regions: ['Hippocampus', 'Precuneus', 'Posterior Cingulate Cortex'],
    functions: ['memory retrieval', 'autobiographical recall', 'emotional memory'],
    keywords: 'childhood classic generations golden heritage history home legend memories miss nostalgia old once original past remember retro reunion roots school simpler throwback tradition vintage wish yesterday young youth'.split(' '),
    interpretations: [
      'Memory circuits activated — nostalgia is a drug and this tweet is the dealer.',
      'Your hippocampus just time-traveled; the present moment lost its grip on you.',
      'Autobiographical memory networks lit up: you\'re feeling, not thinking.',
    ],
  },
  visual_sensory: {
    regions: ['Visual Cortex', 'Fusiform Gyrus', 'Superior Colliculus'],
    functions: ['visual processing', 'pattern recognition', 'visual attention'],
    keywords: 'aesthetic art beautiful bright color dark design eye face film glow gorgeous graphic green icon illustration image landscape light look meme neon paint photo picture pink pixel portrait pretty purple rainbow red scenery screenshot shadow shape sky stunning sunset texture view visual watch'.split(' '),
    interpretations: [
      'Visual processing areas recruited heavily — your attention was captured, not given.',
      'Fusiform gyrus activated: your brain treated this content like a face to memorize.',
      'Your visual cortex processed this faster than language — imagery bypasses critical thinking.',
    ],
  },
};

const _DEFAULT_CAT = {
  regions: ['Prefrontal Cortex', "Wernicke's Area", 'Anterior Cingulate Cortex'],
  functions: ['executive control', 'language comprehension', 'attention allocation'],
  interpretations: [
    'Multiple cortical areas activated — your brain allocated more resources than this tweet deserves.',
    'Default-mode network disrupted: scrolling just became processing.',
    'Language comprehension circuits engaged, extracting meaning from noise.',
  ],
};

function _seededRandom(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  h = Math.abs(h);
  return () => {
    h = (h * 16807 + 0) % 2147483647;
    return (h - 1) / 2147483646;
  };
}

function predictHeuristic(tweetText) {
  const lower = (tweetText || 'empty').toLowerCase();
  const words = new Set(lower.split(/\s+/));
  const rng = _seededRandom(lower);

  const scores = Object.entries(_LEXICONS).map(([name, cat]) => {
    let hits = 0;
    for (const kw of cat.keywords) {
      if (words.has(kw) || lower.includes(kw)) hits++;
    }
    return [name, hits];
  });
  scores.sort((a, b) => b[1] - a[1]);

  const topCats = scores.filter(s => s[1] > 0).slice(0, 2).map(s => s[0]);
  if (topCats.length === 0) topCats.push(scores[0][0]);

  const primary = _LEXICONS[topCats[0]] || _DEFAULT_CAT;
  const secondary = topCats[1] ? (_LEXICONS[topCats[1]] || _DEFAULT_CAT) : _DEFAULT_CAT;

  const pick = (min, max) => +(min + rng() * (max - min)).toFixed(2);

  const regions = [];
  const seen = new Set();

  function addRegion(name, activation, fn) {
    if (!seen.has(name)) {
      seen.add(name);
      regions.push({ name, activation, function: fn });
    }
  }

  addRegion(primary.regions[0], pick(0.65, 0.95), primary.functions[0]);
  addRegion(primary.regions[1] || secondary.regions[0], pick(0.40, 0.70), primary.functions[1] || secondary.functions[0]);
  addRegion(secondary.regions[0] !== primary.regions[0] ? secondary.regions[0] : (primary.regions[2] || _DEFAULT_CAT.regions[0]), pick(0.25, 0.50), secondary.functions[0]);

  while (regions.length < 3) {
    for (const r of _DEFAULT_CAT.regions) {
      if (!seen.has(r)) {
        addRegion(r, pick(0.20, 0.40), _DEFAULT_CAT.functions[regions.length % _DEFAULT_CAT.functions.length]);
        break;
      }
    }
  }

  const idx = Math.floor(rng() * primary.interpretations.length);
  return {
    regions: regions.slice(0, 3),
    interpretation: primary.interpretations[idx],
  };
}

// --------------- Request processing ---------------

async function processRequest(tweetText, settings) {
  const cacheKey = hashText(tweetText);

  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  let result;
  let userEp = (settings.apiEndpoint || '').trim();
  if (userEp.includes('modal.com/apps')) userEp = '';
  const endpoint = userEp || HOSTED_ENDPOINT;

  try {
    if (endpoint) {
      result = await callCustomBackend(tweetText, endpoint);
    } else if (settings.apiKey) {
      result = await callClaudeMVP(tweetText, settings.apiKey);
    } else {
      result = predictHeuristic(tweetText);
    }
  } catch (err) {
    console.warn('[Mindmap] API failed, using heuristic:', err.message);
    result = predictHeuristic(tweetText);
    if (String(err.message || '').startsWith('BACKEND_TIMEOUT')) {
      result = {
        ...result,
        interpretation:
          `[Preview — server timed out after ${BACKEND_FETCH_TIMEOUT_MS / 1000}s; TRIBE may be cold or VPN blocked.] ${result.interpretation}`,
      };
    }
  }

  memoryCache.set(cacheKey, result);

  if (memoryCache.size > 500) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }

  return result;
}

function drainQueue() {
  while (requestQueue.length > 0 && inflightCount < MAX_CONCURRENT) {
    const { tweetText, settings, resolve, reject } = requestQueue.shift();
    inflightCount++;
    processRequest(tweetText, settings)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        inflightCount--;
        drainQueue();
      });
  }
}

function enqueueRequest(tweetText, settings) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ tweetText, settings, resolve, reject });
    drainQueue();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MINDMAP_PREDICT') {
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.enabled) {
          sendResponse({ error: 'Mindmap is disabled' });
          return;
        }
        const result = await enqueueRequest(message.tweetText, settings);
        sendResponse({ data: result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'MINDMAP_GET_SETTINGS') {
    getSettings().then((settings) => {
      let userEp = String(settings.apiEndpoint || '').trim();
      if (userEp.includes('modal.com/apps')) userEp = '';
      const endpoint = String(userEp || HOSTED_ENDPOINT || '').trim();
      const badPlaceholder = endpoint.includes('your-username');
      const hasModal = endpoint.length > 0 && !badPlaceholder;
      const hasBackend = hasModal || !!settings.apiKey;
      sendResponse({ data: settings, hasBackend });
    });
    return true;
  }
});
