// BGG Enhancer — Popup Script

const DEFAULTS = {
  bggUsername: '',
  rapidapiKey: '',
  workerUrl: 'https://bgg-enhancer.workers.dev',
};

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadStats();

  document.getElementById('save-btn').addEventListener('click', saveSettings);
});

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    document.getElementById('bgg-username').value = settings.bggUsername;
    document.getElementById('rapidapi-key').value = settings.rapidapiKey;
    document.getElementById('worker-url').value = settings.workerUrl;
  });
}

function saveSettings() {
  const settings = {
    bggUsername: document.getElementById('bgg-username').value.trim(),
    rapidapiKey: document.getElementById('rapidapi-key').value.trim(),
    workerUrl: document.getElementById('worker-url').value.trim() || DEFAULTS.workerUrl,
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('save-status');
    status.textContent = 'Settings saved!';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });
}

function loadStats() {
  chrome.storage.local.get({ bgg_views: 0 }, (result) => {
    document.getElementById('views-count').textContent = result.bgg_views;
  });
}
