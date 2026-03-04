// BGG Enhancer — Popup Script

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('save-btn').addEventListener('click', saveSettings);
});

function loadSettings() {
  chrome.storage.sync.get({ bggUsername: '', rapidapiKey: '' }, (settings) => {
    document.getElementById('bgg-username').value = settings.bggUsername;
    document.getElementById('rapidapi-key').value = settings.rapidapiKey;
  });
}

function saveSettings() {
  const settings = {
    bggUsername: document.getElementById('bgg-username').value.trim(),
    rapidapiKey: document.getElementById('rapidapi-key').value.trim(),
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('save-status');
    status.textContent = 'Settings saved!';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });
}
