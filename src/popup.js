// Popup script: load settings, save settings, keep it minimal.

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('save-btn').addEventListener('click', saveSettings);
});

function loadSettings() {
  chrome.storage.sync.get({ bggUsername: '' }, (settings) => {
    document.getElementById('bgg-username').value = settings.bggUsername;
  });
}

function saveSettings() {
  const settings = {
    bggUsername: document.getElementById('bgg-username').value.trim(),
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('save-status');
    status.textContent = 'Settings saved!';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });
}
