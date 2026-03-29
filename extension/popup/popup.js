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

function updateStatus(settings, hasBackend) {
  if (!settings.enabled) {
    els.statusDot.className = 'status-dot inactive';
    els.statusText.textContent = 'Disabled';
    return;
  }

  const ok = hasBackend ?? !!(settings.apiEndpoint || settings.apiKey);

  if (ok) {
    els.statusDot.className = 'status-dot active';
    if (settings.apiEndpoint) {
      els.statusText.textContent = 'Ready — Modal URL in settings';
    } else if (settings.apiKey) {
      els.statusText.textContent = 'Ready — Claude direct (your key)';
    } else {
      els.statusText.textContent = 'Ready — bundled backend URL';
    }
    return;
  }

  els.statusDot.className = 'status-dot warning';
  els.statusText.textContent = 'Paste Modal URL (or set key / dev bundle URL)';
}

function loadSettings() {
  chrome.runtime.sendMessage({ type: 'MINDMAP_GET_SETTINGS' }, (response) => {
    const result = response?.data
      ? { mindmap_settings: response.data }
      : {};
    const settings = { ...DEFAULT_SETTINGS, ...(result.mindmap_settings || {}) };

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

  chrome.storage.sync.set({ mindmap_settings: settings });
  updateStatus(settings);
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
