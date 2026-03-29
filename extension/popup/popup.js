const DEFAULT_SETTINGS = {
  enabled: true,
  autoExpand: false,
  threshold: 0,
  apiEndpoint: '',
  apiKey: '',
};

const els = {
  enabled: document.getElementById('enabled'),
  autoExpand: document.getElementById('autoExpand'),
  threshold: document.getElementById('threshold'),
  thresholdValue: document.getElementById('thresholdValue'),
  apiKey: document.getElementById('apiKey'),
  apiEndpoint: document.getElementById('apiEndpoint'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
};

function setStatus(kind, text) {
  els.statusDot.className = 'dot' + (kind === 'on' ? ' on' : kind === 'warn' ? ' warn' : ' off');
  els.statusText.textContent = text;
}

function updateStatus(settings, hasBackend) {
  if (!settings.enabled) {
    setStatus('off', 'Off');
    return;
  }

  const ok = hasBackend ?? !!(settings.apiEndpoint || settings.apiKey);

  if (ok) {
    setStatus('on', 'Backend OK');
    return;
  }

  setStatus('warn', 'Configure Overrides');
}

function loadSettings() {
  chrome.runtime.sendMessage({ type: 'MINDMAP_GET_SETTINGS' }, (response) => {
    const settings = { ...DEFAULT_SETTINGS, ...(response?.data || {}) };

    els.enabled.checked = settings.enabled;
    els.autoExpand.checked = settings.autoExpand;
    els.threshold.value = settings.threshold;
    els.thresholdValue.textContent = `${settings.threshold}%`;
    els.apiKey.value = settings.apiKey;
    els.apiEndpoint.value = settings.apiEndpoint;

    updateStatus(settings, response?.hasBackend);
  });
}

function saveSettings() {
  const settings = {
    enabled: els.enabled.checked,
    autoExpand: els.autoExpand.checked,
    threshold: parseInt(els.threshold.value, 10),
    apiKey: els.apiKey.value.trim(),
    apiEndpoint: els.apiEndpoint.value.trim().replace(/\/$/, ''),
  };

  chrome.storage.sync.set({ mindmap_settings: settings }, () => {
    chrome.runtime.sendMessage({ type: 'MINDMAP_GET_SETTINGS' }, (r) => {
      updateStatus(settings, r?.hasBackend);
    });
  });
}

els.enabled.addEventListener('change', saveSettings);
els.autoExpand.addEventListener('change', saveSettings);
els.threshold.addEventListener('input', () => {
  els.thresholdValue.textContent = `${els.threshold.value}%`;
  saveSettings();
});
els.apiKey.addEventListener('change', saveSettings);
els.apiEndpoint.addEventListener('change', saveSettings);

loadSettings();
