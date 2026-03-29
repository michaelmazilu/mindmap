/* global MindmapBrainWidget, chrome */

(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-mindmap';
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
  const ACTION_BAR_SELECTOR = '[role="group"]';

  let settings = {
    enabled: true,
    autoExpand: false,
    threshold: 0,
  };

  const widgetMap = new WeakMap();

  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'MINDMAP_GET_SETTINGS' }, (response) => {
      if (response && response.data) {
        settings = { ...settings, ...response.data };
      }
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.mindmap_settings) {
      settings = { ...settings, ...changes.mindmap_settings.newValue };
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

    const interpretation = document.createElement('div');
    interpretation.className = 'mindmap-interpretation';
    interpretation.textContent = 'Analyzing neural activation patterns…';

    info.appendChild(regionsContainer);
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

    function expand() {
      if (expanded) return;
      expanded = true;
      panel.classList.add('expanded');
      trigger.classList.add('active');

      if (!widget) {
        widget = new MindmapBrainWidget(canvasContainer);
        widget.setShimmerMode(true);
      }

      if (!dataLoaded) {
        fetchPrediction(tweetText);
      }
    }

    function collapse() {
      expanded = false;
      panel.classList.remove('expanded');
      trigger.classList.remove('active');
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (expanded) collapse();
      else expand();
    });

    function fetchPrediction(text) {
      chrome.runtime.sendMessage(
        { type: 'MINDMAP_PREDICT', tweetText: text },
        (response) => {
          if (chrome.runtime.lastError) {
            showError(inner, interpretation, 'Extension error — reload page');
            return;
          }
          if (response && response.error) {
            showError(inner, interpretation, response.error);
            return;
          }
          if (response && response.data) {
            resultData = response.data;
            dataLoaded = true;
            renderResult(response.data, inner, regionsContainer, interpretation, widget);
          }
        },
      );
    }

    if (settings.autoExpand) {
      expand();
    }

    widgetMap.set(tweetEl, {
      widget,
      expand,
      collapse,
      dispose: () => widget && widget.dispose(),
    });
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

  function renderResult(data, inner, regionsContainer, interpretation, widget) {
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

    if (widget) {
      widget.setShimmerMode(false);
      widget.setActivations(regions);
    }
  }

  function showError(inner, interpretation, message) {
    inner.classList.remove('mindmap-loading');
    interpretation.textContent = '';

    const errEl = document.createElement('div');
    errEl.className = 'mindmap-error';
    errEl.textContent = message;
    inner.querySelector('.mindmap-info').appendChild(errEl);
  }

  function processTweet(tweetEl) {
    if (tweetEl.hasAttribute(PROCESSED_ATTR)) return;
    tweetEl.setAttribute(PROCESSED_ATTR, 'true');

    if (!settings.enabled) return;

    createWidget(tweetEl);
  }

  function scanForTweets() {
    const tweets = document.querySelectorAll(TWEET_SELECTOR);
    tweets.forEach(processTweet);
  }

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const wData = widgetMap.get(entry.target);
        if (!wData) return;

        if (!entry.isIntersecting && wData.widget) {
          // Offscreen — no action needed yet, Three.js handles this efficiently
        }
      });
    },
    { rootMargin: '200px' },
  );

  const mutationObserver = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const mutation of mutations) {
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

    const existingTweets = document.querySelectorAll(TWEET_SELECTOR);
    existingTweets.forEach((tweet) => visibilityObserver.observe(tweet));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
