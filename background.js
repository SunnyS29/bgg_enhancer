// BGG Enhancer — Background Service Worker

const WORKER_URL = 'https://bgg-enhancer.workers.dev';
const CACHE_VERSION = 8; // Bump this to invalidate all cached data after updates

// Clear old cache on startup
chrome.storage.local.get('bgg_cache_version', (result) => {
  if (result.bgg_cache_version !== CACHE_VERSION) {
    console.log('BGG Enhancer: cache version changed, clearing old data');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ bgg_cache_version: CACHE_VERSION });
    });
  }
});

// Shopify stores — use their reliable /search/suggest.json API
const SHOPIFY_STORES = [
  { store: 'Gameology', region: 'AU', baseUrl: 'https://www.gameology.com.au', currency: 'A$' },
  { store: 'GUF', region: 'AU', baseUrl: 'https://www.guf.com.au', currency: 'A$' },
  { store: 'Board Game Master', region: 'AU', baseUrl: 'https://www.boardgamemaster.com.au', currency: 'A$' },
  { store: 'Games Empire', region: 'AU', baseUrl: 'https://www.gamesempire.com.au', currency: 'A$' },
];

// eBay stores — SSR HTML, custom parser
const EBAY_STORES = [
  { store: 'eBay', region: 'US', searchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q + ' board game')}&_sacat=233&LH_BIN=1&_sop=15`, baseUrl: 'https://www.ebay.com' },
  { store: 'eBay AU', region: 'AU', searchUrl: (q) => `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(q + ' board game')}&_sacat=233&LH_BIN=1&_sop=15`, baseUrl: 'https://www.ebay.com.au' },
];

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const DEMO_GAME_DATA = {
  default: {
    rating: 7.2,
    weight: 2.5,
    year: 2020,
    minPlayers: 2,
    maxPlayers: 4,
    playingTime: 60,
    image: null,
  }
};

function getDemoGameData(gameId, gameName) {
  const h = Math.abs(hashCode(gameName || gameId));
  return {
    id: gameId,
    name: gameName || 'Unknown Game',
    rating: +(6.0 + (h % 30) / 10).toFixed(1),
    weight: +(1.5 + (h % 25) / 10).toFixed(1),
    year: 2010 + (h % 16),
    minPlayers: 1 + (h % 3),
    maxPlayers: 2 + (h % 5),
    playingTime: 30 + (h % 6) * 15,
    image: null,
  };
}

async function fetchPrices(gameName, settings) {
  console.log('BGG Enhancer [fetchPrices]:', gameName);

  // Run all price sources in parallel
  const [amazonResults, shopifyResults, ebayResults] = await Promise.all([
    // Amazon via RapidAPI (if key is set)
    settings.rapidapiKey
      ? fetchAmazonDirect(gameName, settings.rapidapiKey).catch((err) => {
          console.warn('BGG Enhancer: Amazon API error:', err.message);
          return [];
        })
      : Promise.resolve([]),
    // Shopify stores via suggest API
    fetchShopifyPrices(gameName).catch((err) => {
      console.warn('BGG Enhancer: Shopify scrape error:', err.message);
      return [];
    }),
    // eBay via HTML scraping
    fetchEbayPrices(gameName).catch((err) => {
      console.warn('BGG Enhancer: eBay scrape error:', err.message);
      return [];
    }),
  ]);

  const prices = [...amazonResults, ...shopifyResults, ...ebayResults];

  // Only keep stores that have a real price and a product URL
  const realPrices = prices.filter((p) => p.price != null && p.url);
  console.log('BGG Enhancer: final results:', realPrices.length, 'stores with real prices');

  return {
    success: true,
    prices: realPrices,
    demo: realPrices.length === 0,
  };
}

async function fetchAmazonDirect(gameName, apiKey) {
  const searchQuery = gameName + ' board game';
  const url = `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(searchQuery)}&country=US&category_id=aps`;

  const resp = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'real-time-amazon-data.p.rapidapi.com',
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Amazon API ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.data?.products?.length) return [];

  // Filter: only products whose title contains the game name as a whole word, skip expansions/accessories
  const gameLower = gameName.toLowerCase();
  const skipWords = ['expansion', 'promo', 'sleeve', 'insert', 'nesting box', 'pack', 'upgrade', 'playmat', 'organizer'];
  // Word boundary regex: game name must appear as a standalone word/phrase
  const nameRegex = new RegExp('\\b' + gameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const relevant = data.data.products.filter((p) => {
    const title = (p.product_title || '').toLowerCase();
    // Game name must appear as a whole word (not inside another word like "Wyrmspan")
    if (!nameRegex.test(title)) return false;
    // Game name should appear early in the title (first 60 chars) to be the primary product
    const namePos = title.indexOf(gameLower);
    if (namePos > 60) return false;
    // Skip accessories and expansions
    if (skipWords.some((sw) => title.includes(sw))) return false;
    return true;
  });

  console.log('BGG Enhancer: Amazon', data.data.products.length, 'total,', relevant.length, 'matching "' + gameName + '"');

  const results = [];
  for (const product of relevant.slice(0, 2)) {
    const priceStr = product.product_price || '';
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
    if (!price || isNaN(price)) continue;

    results.push({
      store: results.length === 0 ? 'Amazon' : `Amazon (#${results.length + 1})`,
      region: 'US',
      price,
      url: product.product_url,
      inStock: !product.is_out_of_stock,
      searchLink: false,
    });
  }
  return results;
}

// --- Shopify store price fetching ---
// Uses Shopify's /search/suggest.json API which returns structured JSON

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

      if (!resp.ok) {
        console.log('BGG Enhancer: Shopify', config.store, 'HTTP', resp.status);
        return null;
      }

      const data = await resp.json();
      const products = data?.resources?.results?.products || [];

      // Find the best matching product (title must contain all words from game name)
      // Score by title length similarity — shortest match is usually the base game
      const skipWords = ['expansion', 'promo', 'sleeve', 'insert', 'nesting box', 'pack', 'upgrade', 'playmat', 'organizer', 'dice'];
      let bestMatch = null;

      for (const product of products) {
        const title = (product.title || '').toLowerCase();
        if (!nameWords.every((w) => title.includes(w))) continue;
        // Skip expansions/accessories
        if (skipWords.some((sw) => title.includes(sw))) continue;

        const price = parseFloat(product.price);
        if (!price || price < 5 || price > 500) continue;

        const productUrl = product.url
          ? config.baseUrl + product.url.split('?')[0]
          : null;

        // Prefer shortest title (closest to just the game name)
        if (!bestMatch || title.length < bestMatch.title.length) {
          bestMatch = {
            store: config.store,
            region: config.region,
            price,
            url: productUrl,
            inStock: product.available !== false,
            searchLink: false,
            title: title,
          };
        }
      }

      if (bestMatch) {
        console.log('BGG Enhancer: Shopify', config.store, '=', config.currency + bestMatch.price, bestMatch.url);
        delete bestMatch.title; // Don't include title in final result
        return bestMatch;
      }

      console.log('BGG Enhancer: Shopify', config.store, '- no matching product in', products.length, 'results');
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

// --- eBay price fetching ---
// eBay uses server-side rendering, parse their HTML for prices

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
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        console.log('BGG Enhancer: eBay', config.store, 'HTTP', resp.status);
        return null;
      }

      const html = await resp.text();
      const parsed = parseEbayHtml(html, nameWords, config.baseUrl);
      if (parsed) {
        console.log('BGG Enhancer: eBay', config.store, '= $' + parsed.price, parsed.url);
        return {
          store: config.store,
          region: config.region,
          price: parsed.price,
          url: parsed.url,
          inStock: true,
          searchLink: false,
        };
      }

      console.log('BGG Enhancer: eBay', config.store, '- no matching listing');
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

function parseEbayHtml(html, nameWords, baseUrl) {
  // eBay SSR uses href=https://ebay.com/itm/XXXX for product links
  // Titles in s-card__title spans, prices in s-card__price spans
  // Strategy: find blocks with itm/ URLs, extract title + price near each

  // Find all item blocks: look for itm/ URLs with surrounding context
  const itemPattern = /href=(https?:\/\/(?:www\.)?ebay\.com(?:\.au)?\/itm\/(\d+)[^\s>]*)/g;
  const items = [];
  const seenIds = new Set();
  let match;
  while ((match = itemPattern.exec(html)) !== null) {
    const itemId = match[2];
    if (seenIds.has(itemId)) continue; // Skip duplicate links for same item
    seenIds.add(itemId);
    const itemUrl = match[1].split('?')[0]; // Clean URL to just https://ebay.com/itm/XXXX
    const pos = match.index;
    // Get surrounding context (2000 chars after the link for title + price)
    const chunk = html.substring(pos, Math.min(html.length, pos + 2000));

    // Extract title from s-card__title
    const titleMatch = chunk.match(/s-card__title[^>]*>(?:<span[^>]*>)?\s*([^<]+)/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim().toLowerCase();

    // Check if title matches the game name
    if (!nameWords.every((w) => title.includes(w))) continue;
    // Skip expansions
    if (title.includes('expansion') || title.includes('promo') || title.includes('sleeve') || title.includes('insert')) continue;

    // Extract price from s-card__price (handles $, AU$, A$)
    const priceMatch = chunk.match(/s-card__price[^>]*>\s*(?:AU?\$|US?\$|\$)\s*([\d,.]+)/);
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!price || price < 5 || price > 500) continue;

    items.push({ url: itemUrl, title: titleMatch[1].trim(), price });
  }

  if (items.length === 0) return null;

  // Return the lowest-priced matching item
  items.sort((a, b) => a.price - b.price);
  return { price: items[0].price, url: items[0].url };
}

async function fetchGameData(gameId, settings) {
  // Always fetch real game data from BGG's free XML API (no worker needed)
  try {
    const resp = await fetch(
      `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`,
      { credentials: 'omit' }
    );
    if (!resp.ok) throw new Error(`BGG API ${resp.status}`);

    const xml = await resp.text();
    const game = parseGameXml(xml, gameId);
    console.log('BGG Enhancer: real game data fetched for', game.name);
    return { success: true, game, demo: false };
  } catch (err) {
    console.warn('BGG Enhancer: BGG API failed, using demo data', err);
    return { success: true, game: getDemoGameData(gameId), demo: true, error: err.message };
  }
}

function parseGameXml(xml, gameId) {
  // Get primary name
  const nameMatch = xml.match(/<name\s+type="primary"[^>]*value="([^"]*)"/i);
  const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : 'Unknown';

  // Get average rating
  const ratingMatch = xml.match(/<average[^>]*value="([^"]*)"/i);
  const rating = ratingMatch ? parseFloat(parseFloat(ratingMatch[1]).toFixed(1)) : null;

  // Get weight
  const weightMatch = xml.match(/<averageweight[^>]*value="([^"]*)"/i);
  const weight = weightMatch ? parseFloat(parseFloat(weightMatch[1]).toFixed(1)) : null;

  // Get year published
  const yearMatch = xml.match(/<yearpublished[^>]*value="([^"]*)"/i);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  // Get player count
  const minMatch = xml.match(/<minplayers[^>]*value="([^"]*)"/i);
  const maxMatch = xml.match(/<maxplayers[^>]*value="([^"]*)"/i);
  const minPlayers = minMatch ? parseInt(minMatch[1]) : null;
  const maxPlayers = maxMatch ? parseInt(maxMatch[1]) : null;

  // Get play time
  const timeMatch = xml.match(/<playingtime[^>]*value="([^"]*)"/i);
  const playingTime = timeMatch ? parseInt(timeMatch[1]) : null;

  // Get image
  const imageMatch = xml.match(/<image>([^<]+)<\/image>/i);
  const image = imageMatch ? imageMatch[1].trim() : null;

  return {
    id: gameId,
    name,
    rating: rating || 7.0,
    weight: weight || 2.5,
    year: year || 2020,
    minPlayers: minPlayers || 2,
    maxPlayers: maxPlayers || 4,
    playingTime: playingTime || 60,
    image,
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

async function fetchCollection(username, settings) {
  const workerUrl = settings.workerUrl || WORKER_URL;

  if (!username) return { success: true, collection: {} };

  if (settings.demoMode) {
    return { success: true, collection: {}, demo: true };
  }

  try {
    const resp = await fetch(
      `${workerUrl}/api/collection/${encodeURIComponent(username)}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.warn('BGG Enhancer: collection fetch failed', err);
    return { success: true, collection: {}, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPrices') {
    handleFetchPrices(message).then(sendResponse);
    return true;
  }
  if (message.action === 'fetchGameData') {
    handleFetchGameData(message).then(sendResponse);
    return true;
  }
  if (message.action === 'fetchCollection') {
    handleFetchCollection(message).then(sendResponse);
    return true;
  }
  if (message.action === 'trackView') {
    trackGameView(message.gameId);
    sendResponse({ ok: true });
    return false;
  }
});

async function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { bggUsername: '', rapidapiKey: '', workerUrl: WORKER_URL },
      resolve
    );
  });
}

async function handleFetchPrices({ gameName, gameId }) {
  const settings = await getStoredSettings();
  console.log('BGG Enhancer [handleFetchPrices]:', { gameName, gameId, hasKey: !!settings.rapidapiKey });

  const cacheKey = `bgg_prices_${gameId}`;
  const cached = await getFromCache(cacheKey, 60 * 60 * 1000);
  // Use cache only if it has real prices
  const cachedHasRealPrices = cached?.prices?.some((p) => p.price != null);
  if (cached && cachedHasRealPrices) {
    console.log('BGG Enhancer: using cached prices for', gameId, '(' + cached.prices.length + ' results)');
    return cached;
  }

  console.log('BGG Enhancer: fetching fresh prices for', gameName);
  const result = await fetchPrices(gameName, settings);
  // Only cache if we got real prices
  const hasRealPrices = result.prices?.some((p) => p.price != null);
  if (result.success && hasRealPrices) await setInCache(cacheKey, result);
  return result;
}

async function handleFetchGameData({ gameId }) {
  const cacheKey = `bgg_game_${gameId}`;
  const cached = await getFromCache(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  const settings = await getStoredSettings();
  const result = await fetchGameData(gameId, settings);
  if (result.success) await setInCache(cacheKey, result);
  return result;
}

async function handleFetchCollection({ username }) {
  const cacheKey = `bgg_collection_${username}`;
  const cached = await getFromCache(cacheKey, 30 * 60 * 1000);
  if (cached) return cached;

  const settings = await getStoredSettings();
  const result = await fetchCollection(username, settings);
  if (result.success) await setInCache(cacheKey, result);
  return result;
}

async function getFromCache(key, ttl) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      if (entry && Date.now() - entry.ts < ttl) {
        resolve(entry.data);
      } else {
        resolve(null);
      }
    });
  });
}

async function setInCache(key, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: { data, ts: Date.now() } }, resolve);
  });
}

function trackGameView(gameId) {
  chrome.storage.local.get({ bgg_views: 0 }, (result) => {
    chrome.storage.local.set({ bgg_views: result.bgg_views + 1 });
  });
}
