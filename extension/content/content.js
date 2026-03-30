/* global MindmapBrainWidget, chrome */

(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-mindmap';
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
  const ACTION_BAR_SELECTOR = '[role="group"]';

  /** Root posts only — skip replies (short, low-signal for brain viz). */
  function isReplyTweet(article) {
    const ctx = article.querySelector('[data-testid="socialContext"]');
    if (!ctx) return false;
    const t = (ctx.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return t.includes('replying to');
  }

  let settings = {
    enabled: true,
    autoExpand: false,
    threshold: 0,
  };

  const widgetMap = new WeakMap();

  /**
   * After extension reload/update, content scripts keep running but chrome.runtime is dead.
   * Without this, sendMessage throws "Extension context invalidated".
   */
  function safeRuntimeSendMessage(message, callback) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        callback(null, new Error('Extension unavailable'));
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        const le = chrome.runtime.lastError;
        if (le) {
          const msg = le.message || String(le);
          if (/context invalidated|extension context/i.test(msg)) {
            callback(null, new Error('Mindmap was reloaded — refresh this page (F5)'));
            return;
          }
          callback(null, new Error(msg));
          return;
        }
        callback(response, null);
      });
    } catch (e) {
      callback(null, e instanceof Error ? e : new Error(String(e)));
    }
  }

  function loadSettings() {
    safeRuntimeSendMessage({ type: 'MINDMAP_GET_SETTINGS' }, (response, err) => {
      if (err || !response || !response.data) return;
      settings = { ...settings, ...response.data };
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return;
      if (changes.mindmap_settings) {
        settings = { ...settings, ...changes.mindmap_settings.newValue };
      }
    } catch (e) {
      /* invalid context */
    }
  });

  function extractTweetText(tweetEl) {
    const textEl = tweetEl.querySelector(TWEET_TEXT_SELECTOR);
    if (!textEl) return null;
    return textEl.innerText.trim();
  }

  function getActivationColor(value) {
    if (value > 0.66) return '#ffdd00';
    if (value > 0.33) return '#ff4500';
    return '#8b0000';
  }

  function getBarGradient(value) {
    if (value > 0.66) return 'linear-gradient(90deg, #8b0000, #ff4500, #ffdd00)';
    if (value > 0.33) return 'linear-gradient(90deg, #8b0000, #ff4500)';
    return '#8b0000';
  }

  /**
   * Copy patterns that often aim to provoke, shame, or spike stress — TRIBE only sees
   * language-related cortex for many of these, so region names alone miss "ragebait".
   */
  function isRagebaitTweetText(text) {
    const s = (text || '').toLowerCase();
    if (!s.trim()) return false;
    if (/absurd|outrage|disgusting|vile|scam|liar|fraud|pathetic|unforgivable|\bhate\b|\bangry\b|\brage\b|crook|evil\b|cruel|hypocrisy|injustice|manipulat/i.test(s)) {
      return true;
    }
    if (/leave you with nothing|expensive dopamine|don'?t leave you|nothing when you|while you(?:'re| are) (?:busy|asleep|scrolling)/i.test(s)) {
      return true;
    }
    if (/\bdopamine\b/.test(s) && /(?:gym|business|grind|hustle|obsess|progress|momentum|skill|game)/i.test(s)) {
      return true;
    }
    if (/\b(?:you'?re|you are) (?:lazy|weak|wrong|stupid|pathetic|soft)\b/i.test(s)) {
      return true;
    }
    return false;
  }

  /** Limbic / anger–threat circuitry, interpretation, or manipulative copy. */
  function isRagebaitActivation(data, tweetText) {
    if (isRagebaitTweetText(tweetText)) return true;
    const regions = data.regions || [];
    const patterns = [
      /amygdal/i,
      /\binsul/i,
      /hypothal/i,
      /periaqueduct/i,
      /threat\s+detection/i,
      /moral\s+disgust/i,
      /emotional\s+arousal/i,
      /conflict\s+monitoring/i,
      /outrage/i,
      /\brage\b/i,
      /\bang(er|ry)\b/i,
      /hostilit/i,
      /aggress/i,
    ];
    for (const r of regions) {
      const act = Number(r.activation) || 0;
      if (act < 0.32) continue;
      const blob = `${r.name || ''} ${r.function || ''}`;
      for (const p of patterns) {
        if (p.test(blob)) return true;
      }
    }
    const interp = data.interpretation || '';
    if (/\brage|outrage|ragebait|amygdal|threat|anger\b|cortisol/i.test(interp)) {
      return true;
    }
    return false;
  }

  /**
   * Felt affect from wording — TRIBE region labels describe *where* language is processed,
   * not whether the post is motivational bait, outrage, etc.
   */
  function inferEmotionFromTweetText(text) {
    const t = (text || '').toLowerCase();
    if (!t.trim()) return null;
    const ordered = [
      {
        re: /absurd|outrage|disgusting|vile|scam|liar|fraud|pathetic|unforgivable|\bhate\b|\bangry\b|\brage\b|crook|evil\b|cruel|hypocrisy|injustice|immoral|incompetent|idiot|stupid|terrible|awful|wrongdoing/i,
        label: 'Indignation or reactive anger',
      },
      {
        re: /\bdanger\b|threat|afraid|anxiety|panic|terror|disaster|emergency|violence|\bkill\b|\bdeath\b|catastrophe/i,
        label: 'Unease or vigilance',
      },
      {
        re: /leave you with nothing|expensive dopamine|don'?t leave you|nothing when you|while you(?:'re| are) (?:busy|asleep)/i,
        label: 'Comparison or inadequacy bait',
      },
      {
        re: /\bdopamine\b|obsess|obsession|momentum|grind\b|hustle|\bsigma\b|push into|become obsessed|build momentum|no excuses|discipline|10x|grindset/i,
        label: 'Driven craving or self-pressure',
      },
      {
        re: /millionaire|crypto|\bnft\b|jackpot|passive income|free money|\$\d{2,}|\bcash\b.*\b(?:fast|now|easy)/i,
        label: 'Wanting or anticipation',
      },
      {
        re: /nostalgia|remember when|throwback|childhood|back in the day/i,
        label: 'Nostalgia or self-reflection',
      },
    ];
    for (const { re, label } of ordered) {
      if (re.test(t)) return label;
    }
    return null;
  }

  /**
   * Guess the dominant feeling the content is "designed" to evoke, from region labels
   * (TRIBE Destrieux names, heuristic names, or API function strings). Activation weights the mix.
   */
  function inferDominantEmotion(regions, tweetText) {
    const fromText = inferEmotionFromTweetText(tweetText);
    if (fromText) return fromText;

    if (!regions || !regions.length) return 'Absorbed attention';

    const rules = [
      { re: /amygdal|threat|fear|panic|terror|hypothal|trauma/, label: 'Unease or vigilance' },
      { re: /insula|disgust|moral|outrage|indign|hostil|rage|anger/, label: 'Indignation or disgust' },
      { re: /accumbens|reward|orbitofront|value|anticipat|wanting/, label: 'Wanting or anticipation' },
      { re: /hippocamp|memory|nostalgia|precuneus|posterior cingul/, label: 'Nostalgia or self-reflection' },
      /* Destrieux temporal labels = language cortex for reading, not "curiosity" as a feeling */
      { re: /temporal|heschl|planum|wernicke|broca|language|semantic|comprehen|transverse|sup-t|g temp|temp sup|collat/, label: 'Absorbed attention to language' },
      { re: /occipital|visual|calcar|fusiform|v1|v2|striate/, label: 'Visual fascination' },
      { re: /prefrontal|dorsolateral|executive|working memory|angular|parietal/, label: 'Careful evaluation' },
      { re: /cingul|conflict|monitoring|acc\b/, label: 'Inner tension or doubt' },
      { re: /motor|precentral|supplement|sma/, label: 'Urge to act or respond' },
      { re: /\bsts\b|social|pole|mirror|bonding/, label: 'Social comparison or empathy pull' },
    ];

    const scores = new Map();
    for (const r of regions) {
      const act = Math.max(0, Math.min(1, Number(r.activation) || 0.5));
      const blob = `${r.name || ''} ${r.function || ''}`.toLowerCase();
      for (const { re, label } of rules) {
        if (re.test(blob)) {
          scores.set(label, (scores.get(label) || 0) + act);
        }
      }
    }

    if (scores.size === 0) return 'Absorbed attention';

    let best = 'Absorbed attention';
    let bestScore = 0;
    for (const [label, s] of scores) {
      if (s > bestScore) {
        bestScore = s;
        best = label;
      }
    }
    return best;
  }

  function createWidget(tweetEl) {
    const tweetText = extractTweetText(tweetEl);
    if (!tweetText || tweetText.length < 5) return;

    const actionBar = tweetEl.querySelector(ACTION_BAR_SELECTOR);
    if (!actionBar) return;

    const trigger = document.createElement('button');
    trigger.className = 'mindmap-trigger';
    trigger.innerHTML = '<span class="brain-icon">🧠</span><span>Mindmap</span>';

    const panel = document.createElement('div');
    panel.className = 'mindmap-panel';

    const inner = document.createElement('div');
    inner.className = 'mindmap-panel-inner mindmap-loading';

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'mindmap-canvas-container';

    const info = document.createElement('div');
    info.className = 'mindmap-info';

    const regionsContainer = document.createElement('div');
    regionsContainer.className = 'mindmap-regions';

    for (let i = 0; i < 3; i++) {
      regionsContainer.appendChild(createRegionRow('—', 0, ''));
    }

    const emotionBlock = document.createElement('div');
    emotionBlock.className = 'mindmap-emotion';
    emotionBlock.setAttribute('aria-live', 'polite');
    emotionBlock.innerHTML =
      '<span class="mindmap-emotion-label">Likely felt emotion</span>'
      + '<span class="mindmap-emotion-value">—</span>';

    const ragebait = document.createElement('div');
    ragebait.className = 'mindmap-ragebait';
    ragebait.hidden = true;
    ragebait.setAttribute('aria-live', 'polite');

    const interpretation = document.createElement('div');
    interpretation.className = 'mindmap-interpretation';
    interpretation.textContent = 'Analyzing neural activation patterns…';

    info.appendChild(regionsContainer);
    info.appendChild(emotionBlock);
    info.appendChild(ragebait);
    info.appendChild(interpretation);
    inner.appendChild(canvasContainer);
    inner.appendChild(info);
    panel.appendChild(inner);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'width: 100%;';
    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);

    actionBar.parentNode.insertBefore(wrapper, actionBar.nextSibling);

    let widget = null;
    let dataLoaded = false;
    let expanded = false;
    let resultData = null;

    function sortRegionsDesc(regions) {
      return (regions || []).slice().sort((a, b) => b.activation - a.activation);
    }

    function expand() {
      if (expanded) return;
      expanded = true;
      panel.classList.add('expanded');
      trigger.classList.add('active');

      if (!widget) {
        try {
          widget = new MindmapBrainWidget(canvasContainer);
          if (dataLoaded && resultData) {
            widget.setShimmerMode(false);
            try {
              widget.setActivations(sortRegionsDesc(resultData.regions));
            } catch (e) {
              console.warn('[Mindmap] setActivations', e);
            }
          } else {
            widget.setShimmerMode(true);
          }
        } catch (e) {
          console.warn('[Mindmap] WebGL / brain widget failed — still fetching data', e);
          widget = null;
        }
      }

      if (!dataLoaded) {
        fetchPrediction(tweetText);
      }
    }

    function collapse() {
      expanded = false;
      panel.classList.remove('expanded');
      trigger.classList.remove('active');
      if (widget) {
        try {
          widget.dispose();
        } catch (e) {
          console.warn('[Mindmap] dispose', e);
        }
        widget = null;
      }
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (expanded) collapse();
      else expand();
    });

    function fetchPrediction(text) {
      safeRuntimeSendMessage({ type: 'MINDMAP_PREDICT', tweetText: text }, (response, err) => {
        try {
          if (err) {
            showError(inner, interpretation, err.message || 'Extension error — reload page');
            return;
          }
          if (response && response.error) {
            showError(inner, interpretation, response.error);
            return;
          }
          if (response && response.data) {
            resultData = response.data;
            dataLoaded = true;
            renderResult(response.data, inner, regionsContainer, interpretation, widget, text);
          } else {
            showError(inner, interpretation, 'No data from extension — reload the page');
          }
        } catch (e) {
          console.warn('[Mindmap] render failed', e);
          showError(inner, interpretation, 'Mindmap UI error — try collapsing and reopening');
        }
      });
    }

    if (settings.autoExpand) {
      expand();
    }

    widgetMap.set(tweetEl, {
      get widget() {
        return widget;
      },
      expand,
      collapse,
      disposeWebGL() {
        if (widget) {
          try {
            widget.dispose();
          } catch (e) {
            /* ignore */
          }
          widget = null;
        }
      },
    });
  }

  function cleanupRemovedTweet(article) {
    const data = widgetMap.get(article);
    if (data && typeof data.disposeWebGL === 'function') {
      data.disposeWebGL();
    }
    try {
      widgetMap.delete(article);
    } catch (e) {
      /* WeakMap.delete may be unsupported in very old engines */
    }
  }

  function createRegionRow(name, activation, func) {
    const row = document.createElement('div');
    row.className = 'mindmap-region';

    const indicator = document.createElement('div');
    indicator.className = 'mindmap-region-indicator';
    indicator.style.background = getActivationColor(activation);

    const nameEl = document.createElement('span');
    nameEl.className = 'mindmap-region-name';
    nameEl.textContent = name;
    if (func) nameEl.title = func;

    const barContainer = document.createElement('div');
    barContainer.className = 'mindmap-region-bar-container';

    const bar = document.createElement('div');
    bar.className = 'mindmap-region-bar';
    bar.style.width = '0%';
    bar.style.background = getBarGradient(activation);

    barContainer.appendChild(bar);

    const pct = document.createElement('span');
    pct.className = 'mindmap-region-pct';
    pct.textContent = activation > 0 ? `${Math.round(activation * 100)}%` : '—';

    row.appendChild(indicator);
    row.appendChild(nameEl);
    row.appendChild(barContainer);
    row.appendChild(pct);

    return row;
  }

  function renderResult(data, inner, regionsContainer, interpretation, widget, tweetText) {
    inner.classList.remove('mindmap-loading');

    regionsContainer.innerHTML = '';

    const regions = data.regions || [];
    regions.sort((a, b) => b.activation - a.activation);

    regions.forEach((region, index) => {
      const row = createRegionRow(
        region.name,
        region.activation,
        region.function || '',
      );

      row.addEventListener('mouseenter', () => {
        if (widget) widget.highlightRegion(index);
        row.classList.add('highlighted');
      });
      row.addEventListener('mouseleave', () => {
        if (widget) widget.clearHighlight();
        row.classList.remove('highlighted');
      });

      regionsContainer.appendChild(row);

      requestAnimationFrame(() => {
        const bar = row.querySelector('.mindmap-region-bar');
        if (bar) bar.style.width = `${Math.round(region.activation * 100)}%`;
      });
    });

    if (data.interpretation) {
      interpretation.textContent = `"${data.interpretation}"`;
    }

    const rb = inner.querySelector('.mindmap-ragebait');
    if (rb) {
      if (isRagebaitActivation(data, tweetText)) {
        rb.textContent = 'Ragebait detected, avoid cortisol spike';
        rb.hidden = false;
      } else {
        rb.textContent = '';
        rb.hidden = true;
      }
    }

    const emoVal = inner.querySelector('.mindmap-emotion-value');
    if (emoVal) {
      emoVal.textContent = inferDominantEmotion(regions, tweetText);
    }

    if (widget && !widget.disposed) {
      try {
        widget.setShimmerMode(false);
        widget.setActivations(regions);
      } catch (e) {
        console.warn('[Mindmap] brain update after load', e);
      }
    }
  }

  function showError(inner, interpretation, message) {
    inner.classList.remove('mindmap-loading');
    interpretation.textContent = '';

    const rb = inner.querySelector('.mindmap-ragebait');
    if (rb) {
      rb.textContent = '';
      rb.hidden = true;
    }

    const emoValErr = inner.querySelector('.mindmap-emotion-value');
    if (emoValErr) emoValErr.textContent = '—';

    const errEl = document.createElement('div');
    errEl.className = 'mindmap-error';
    errEl.textContent = message;
    inner.querySelector('.mindmap-info').appendChild(errEl);
  }

  function processTweet(tweetEl) {
    if (tweetEl.hasAttribute(PROCESSED_ATTR)) return;
    tweetEl.setAttribute(PROCESSED_ATTR, 'true');

    if (!settings.enabled) return;
    if (isReplyTweet(tweetEl)) return;

    createWidget(tweetEl);
  }

  function scanForTweets() {
    const tweets = document.querySelectorAll(TWEET_SELECTOR);
    tweets.forEach(processTweet);
  }

  const mutationObserver = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.removedNodes && mutation.removedNodes.length > 0) {
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches && node.matches(TWEET_SELECTOR)) {
            cleanupRemovedTweet(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(TWEET_SELECTOR).forEach(cleanupRemovedTweet);
          }
        }
      }
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches(TWEET_SELECTOR)) {
              processTweet(node);
            } else if (node.querySelector) {
              const tweets = node.querySelectorAll(TWEET_SELECTOR);
              if (tweets.length > 0) {
                shouldScan = true;
                break;
              }
            }
          }
        }
      }
    }
    if (shouldScan) {
      requestAnimationFrame(scanForTweets);
    }
  });

  let debounceTimer = null;
  function debouncedScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanForTweets, 300);
  }

  function init() {
    loadSettings();

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scanForTweets();

    window.addEventListener('scroll', debouncedScan, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
