const MAX_CONCURRENT = 3;
let inflightCount = 0;
const requestQueue = [];
const memoryCache = new Map();

// Default Modal API host (from `modal deploy` — not the modal.com dashboard URL).
// If yours differs, check Modal → your app → the HTTPS endpoint shown after deploy.
const HOSTED_ENDPOINT =
  'https://michaelmazilu08--mindmap-backend-fastapi-app.modal.run';

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
      model: 'claude-sonnet-4-20250514',
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
      'Backend URL not set. Set HOSTED_ENDPOINT in service-worker.js or Overrides in the popup.',
    );
  }
  if (endpoint.includes('modal.com/apps')) {
    throw new Error(
      'That is the Modal dashboard URL. Use the API host ending in .modal.run (shown after modal deploy).',
    );
  }

  let response;
  try {
    response = await fetch(normalizePredictUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweet_text: tweetText }),
    });
  } catch (e) {
    throw new Error(
      'Cannot reach backend (network). Confirm the Modal URL, reload the extension after updating manifest, and try again.',
    );
  }

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Backend error ${response.status}${err ? `: ${err.slice(0, 120)}` : ''}`);
  }
  return await response.json();
}

async function processRequest(tweetText, settings) {
  const cacheKey = hashText(tweetText);

  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  let result;
  let userEp = (settings.apiEndpoint || '').trim();
  if (userEp.includes('modal.com/apps')) userEp = '';
  const endpoint = userEp || HOSTED_ENDPOINT;
  if (endpoint) {
    result = await callCustomBackend(tweetText, endpoint);
  } else if (settings.apiKey) {
    result = await callClaudeMVP(tweetText, settings.apiKey);
  } else {
    throw new Error('No backend configured. Open Mindmap settings.');
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
