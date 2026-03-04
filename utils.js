// BGG Enhancer — Shared Utilities

const BGG_ENHANCER = {
  WORKER_URL: 'https://bgg-enhancer.workers.dev',
  CACHE_TTL_PRICES: 60 * 60 * 1000, // 1 hour
  CACHE_TTL_GAME: 6 * 60 * 60 * 1000, // 6 hours
  CACHE_TTL_COLLECTION: 30 * 60 * 1000, // 30 minutes
};

function parseBggUrl() {
  const match = window.location.pathname.match(/\/boardgame\/(\d+)/);
  if (!match) return null;
  return { gameId: match[1] };
}


function formatPrice(price) {
  if (price == null) return 'N/A';
  return '$' + Number(price).toFixed(2);
}

function getCacheKey(prefix, id) {
  return `bgg_enhancer_${prefix}_${id}`;
}

async function getCached(key, ttl) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      if (entry && Date.now() - entry.timestamp < ttl) {
        resolve(entry.data);
      } else {
        resolve(null);
      }
    });
  });
}

async function setCache(key, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: { data, timestamp: Date.now() } }, resolve);
  });
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { bggUsername: '', demoMode: true, workerUrl: BGG_ENHANCER.WORKER_URL },
      resolve
    );
  });
}
