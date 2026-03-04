// BGG Enhancer — Background Service Worker

const CACHE_VERSION = 9;

// Clear old cache on startup
chrome.storage.local.get('bgg_cache_version', (result) => {
  if (result.bgg_cache_version !== CACHE_VERSION) {
    console.log('BGG Enhancer: cache version changed, clearing old data');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ bgg_cache_version: CACHE_VERSION });
    });
  }
});

// --- Store Configs ---

const SHOPIFY_STORES = [
  { store: 'Gameology', region: 'AU', baseUrl: 'https://www.gameology.com.au', currency: 'A$' },
  { store: 'GUF', region: 'AU', baseUrl: 'https://www.guf.com.au', currency: 'A$' },
  { store: 'Board Game Master', region: 'AU', baseUrl: 'https://www.boardgamemaster.com.au', currency: 'A$' },
  { store: 'Games Empire', region: 'AU', baseUrl: 'https://www.gamesempire.com.au', currency: 'A$' },
];

const EBAY_STORES = [
  {
    store: 'eBay',
    region: 'US',
    searchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q + ' board game')}&_sacat=233&LH_BIN=1&_sop=15`,
    baseUrl: 'https://www.ebay.com',
  },
  {
    store: 'eBay AU',
    region: 'AU',
    searchUrl: (q) => `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(q + ' board game')}&_sacat=233&LH_BIN=1&_sop=15`,
    baseUrl: 'https://www.ebay.com.au',
  },
];

const SKIP_WORDS = ['expansion', 'promo', 'sleeve', 'insert', 'nesting box', 'pack', 'upgrade', 'playmat', 'organizer', 'dice'];

// --- Message Handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPrices') {
    handleFetchPrices(message).then(sendResponse);
    return true;
  }
  if (message.action === 'fetchGameData') {
    handleFetchGameData(message).then(sendResponse);
    return true;
  }
});

// --- Price Fetching ---

async function handleFetchPrices({ gameName, gameId }) {
  const settings = await getStoredSettings();

  const cacheKey = `bgg_prices_${gameId}`;
  const cached = await getFromCache(cacheKey, 60 * 60 * 1000);
  if (cached?.prices?.some((p) => p.price != null)) {
    console.log('BGG Enhancer: cached prices for', gameId);
    return cached;
  }

  console.log('BGG Enhancer: fetching prices for', gameName);
  const result = await fetchPrices(gameName, settings);

  if (result.success && result.prices.some((p) => p.price != null)) {
    await setInCache(cacheKey, result);
  }
  return result;
}

async function fetchPrices(gameName, settings) {
  const [amazonResults, shopifyResults, ebayResults] = await Promise.all([
    settings.rapidapiKey
      ? fetchAmazonDirect(gameName, settings.rapidapiKey).catch((err) => {
          console.warn('BGG Enhancer: Amazon error:', err.message);
          return [];
        })
      : Promise.resolve([]),
    fetchShopifyPrices(gameName).catch((err) => {
      console.warn('BGG Enhancer: Shopify error:', err.message);
      return [];
    }),
    fetchEbayPrices(gameName).catch((err) => {
      console.warn('BGG Enhancer: eBay error:', err.message);
      return [];
    }),
  ]);

  const prices = [...amazonResults, ...shopifyResults, ...ebayResults].filter(
    (p) => p.price != null && p.url
  );

  console.log('BGG Enhancer: found', prices.length, 'prices');
  return { success: true, prices };
}

// --- Amazon via RapidAPI ---

async function fetchAmazonDirect(gameName, apiKey) {
  const url = `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(gameName + ' board game')}&country=US&category_id=aps`;

  const resp = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'real-time-amazon-data.p.rapidapi.com',
    },
  });

  if (!resp.ok) throw new Error(`Amazon API ${resp.status}`);

  const data = await resp.json();
  if (!data.data?.products?.length) return [];

  const gameLower = gameName.toLowerCase();
  const nameRegex = new RegExp('\\b' + gameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');

  const relevant = data.data.products.filter((p) => {
    const title = (p.product_title || '').toLowerCase();
    if (!nameRegex.test(title)) return false;
    if (title.indexOf(gameLower) > 60) return false;
    if (SKIP_WORDS.some((sw) => title.includes(sw))) return false;
    return true;
  });

  const results = [];
  for (const product of relevant.slice(0, 2)) {
    const price = parseFloat((product.product_price || '').replace(/[^0-9.]/g, ''));
    if (!price || isNaN(price)) continue;

    results.push({
      store: results.length === 0 ? 'Amazon' : `Amazon (#${results.length + 1})`,
      region: 'US',
      price,
      url: product.product_url,
      inStock: !product.is_out_of_stock,
    });
  }
  return results;
}

// --- Shopify Stores ---

async function fetchShopifyPrices(gameName) {
  const nameWords = gameName.toLowerCase().split(/\s+/);
  const results = [];

  const promises = SHOPIFY_STORES.map(async (config) => {
    try {
      const url = `${config.baseUrl}/search/suggest.json?q=${encodeURIComponent(gameName)}&resources[type]=product&resources[limit]=5`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return null;

      const data = await resp.json();
      const products = data?.resources?.results?.products || [];

      let bestMatch = null;
      for (const product of products) {
        const title = (product.title || '').toLowerCase();
        if (!nameWords.every((w) => title.includes(w))) continue;
        if (SKIP_WORDS.some((sw) => title.includes(sw))) continue;

        const price = parseFloat(product.price);
        if (!price || price < 5 || price > 500) continue;

        const productUrl = product.url ? config.baseUrl + product.url.split('?')[0] : null;

        if (!bestMatch || title.length < bestMatch.titleLen) {
          bestMatch = {
            store: config.store,
            region: config.region,
            price,
            url: productUrl,
            inStock: product.available !== false,
            titleLen: title.length,
          };
        }
      }

      if (bestMatch) {
        delete bestMatch.titleLen;
        return bestMatch;
      }
      return null;
    } catch (err) {
      console.log('BGG Enhancer: Shopify', config.store, 'failed:', err.message);
      return null;
    }
  });

  const settled = await Promise.all(promises);
  for (const r of settled) {
    if (r) results.push(r);
  }
  return results;
}

// --- eBay ---

async function fetchEbayPrices(gameName) {
  const nameWords = gameName.toLowerCase().split(/\s+/);
  const results = [];

  const promises = EBAY_STORES.map(async (config) => {
    try {
      const url = config.searchUrl(gameName);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      });
      clearTimeout(timeout);
      if (!resp.ok) return null;

      const html = await resp.text();
      const parsed = parseEbayHtml(html, nameWords);
      if (parsed) {
        return {
          store: config.store,
          region: config.region,
          price: parsed.price,
          url: parsed.url,
          inStock: true,
        };
      }
      return null;
    } catch (err) {
      console.log('BGG Enhancer: eBay', config.store, 'failed:', err.message);
      return null;
    }
  });

  const settled = await Promise.all(promises);
  for (const r of settled) {
    if (r) results.push(r);
  }
  return results;
}

function parseEbayHtml(html, nameWords) {
  const itemPattern = /href=(https?:\/\/(?:www\.)?ebay\.com(?:\.au)?\/itm\/(\d+)[^\s>]*)/g;
  const items = [];
  const seenIds = new Set();
  let match;

  while ((match = itemPattern.exec(html)) !== null) {
    const itemId = match[2];
    if (seenIds.has(itemId)) continue;
    seenIds.add(itemId);

    const itemUrl = match[1].split('?')[0];
    const chunk = html.substring(match.index, Math.min(html.length, match.index + 2000));

    const titleMatch = chunk.match(/s-card__title[^>]*>(?:<span[^>]*>)?\s*([^<]+)/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim().toLowerCase();

    if (!nameWords.every((w) => title.includes(w))) continue;
    if (['expansion', 'promo', 'sleeve', 'insert'].some((w) => title.includes(w))) continue;

    const priceMatch = chunk.match(/s-card__price[^>]*>\s*(?:AU?\$|US?\$|\$)\s*([\d,.]+)/);
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!price || price < 5 || price > 500) continue;

    items.push({ url: itemUrl, price });
  }

  if (items.length === 0) return null;
  items.sort((a, b) => a.price - b.price);
  return items[0];
}

// --- Game Data from BGG XML API ---

async function handleFetchGameData({ gameId }) {
  const cacheKey = `bgg_game_${gameId}`;
  const cached = await getFromCache(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  const result = await fetchGameData(gameId);
  if (result.success) await setInCache(cacheKey, result);
  return result;
}

async function fetchGameData(gameId) {
  try {
    const resp = await fetch(
      `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`,
      { credentials: 'omit' }
    );
    if (!resp.ok) throw new Error(`BGG API ${resp.status}`);

    const xml = await resp.text();
    return { success: true, game: parseGameXml(xml, gameId) };
  } catch (err) {
    console.warn('BGG Enhancer: BGG API failed:', err.message);
    return { success: false, game: null, error: err.message };
  }
}

function parseGameXml(xml, gameId) {
  const get = (pattern) => {
    const m = xml.match(pattern);
    return m ? m[1] : null;
  };

  const name = get(/<name\s+type="primary"[^>]*value="([^"]*)"/i);
  const year = get(/<yearpublished[^>]*value="([^"]*)"/i);
  const minP = get(/<minplayers[^>]*value="([^"]*)"/i);
  const maxP = get(/<maxplayers[^>]*value="([^"]*)"/i);
  const time = get(/<playingtime[^>]*value="([^"]*)"/i);
  const rating = get(/<average[^>]*value="([^"]*)"/i);
  const weight = get(/<averageweight[^>]*value="([^"]*)"/i);
  const image = get(/<image>([^<]+)<\/image>/i);

  return {
    id: gameId,
    name: name ? decodeXmlEntities(name) : 'Unknown',
    rating: rating ? parseFloat(parseFloat(rating).toFixed(1)) : 0,
    weight: weight ? parseFloat(parseFloat(weight).toFixed(1)) : 0,
    year: year ? parseInt(year) : 0,
    minPlayers: minP ? parseInt(minP) : 0,
    maxPlayers: maxP ? parseInt(maxP) : 0,
    playingTime: time ? parseInt(time) : 0,
    image: image ? image.trim() : null,
  };
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

// --- Settings & Cache Helpers ---

async function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ bggUsername: '', rapidapiKey: '' }, resolve);
  });
}

async function getFromCache(key, ttl) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      resolve(entry && Date.now() - entry.ts < ttl ? entry.data : null);
    });
  });
}

async function setInCache(key, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: { data, ts: Date.now() } }, resolve);
  });
}
