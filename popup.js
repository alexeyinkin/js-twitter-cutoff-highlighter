const DEFAULT_SETTINGS = {
  limit: 280,
  highlightColor: '#f4212e',
  highlightOpacity: 0.25,
  showBadge: true,
  weightedCounting: true
};

const storage = (typeof browser !== 'undefined' && browser.storage) ? browser.storage.local : chrome.storage.local;

const els = {
  limit: document.getElementById('limit'),
  highlightColor: document.getElementById('highlightColor'),
  showBadge: document.getElementById('showBadge'),
  weightedCounting: document.getElementById('weightedCounting'),
  resetBtn: document.getElementById('resetBtn')
};

function renderForm(settings) {
  els.limit.value = settings.limit;
  els.highlightColor.value = settings.highlightColor;
  els.showBadge.checked = settings.showBadge;
  els.weightedCounting.checked = settings.weightedCounting;
}

function saveSettings() {
  const updated = {
    limit: Math.max(10, parseInt(els.limit.value, 10) || 280),
    highlightColor: els.highlightColor.value || '#f4212e',
    showBadge: els.showBadge.checked,
    weightedCounting: els.weightedCounting.checked
  };
  storage.set(updated);
}

storage.get(DEFAULT_SETTINGS, (res) => {
  renderForm({ ...DEFAULT_SETTINGS, ...res });
});

['limit', 'highlightColor', 'showBadge', 'weightedCounting'].forEach((key) => {
  els[key].addEventListener('input', saveSettings);
  els[key].addEventListener('change', saveSettings);
});

els.resetBtn.addEventListener('click', () => {
  storage.set(DEFAULT_SETTINGS, () => {
    renderForm(DEFAULT_SETTINGS);
  });
});
