// BGG Price Compare AU — Background Service Worker

const CACHE_VERSION = 12;

// Clear old cache on version change
chrome.storage.local.get('bgg_cache_version', (result) => {
  if (result.bgg_cache_version !== CACHE_VERSION) {
    console.log('BGG AU: cache version changed, clearing old data');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ bgg_cache_version: CACHE_VERSION });
    });
  }
});

// --- AU Store Configs ---

const SHOPIFY_STORES = [
  { store: 'Gameology', baseUrl: 'https://www.gameology.com.au' },
  { store: 'GUF', baseUrl: 'https://www.guf.com.au' },
  { store: 'Board Game Master', baseUrl: 'https://www.boardgamemaster.com.au' },
  { store: 'Games Empire', baseUrl: 'https://www.gamesempire.com.au' },
  { store: 'Good Games', baseUrl: 'https://www.goodgames.com.au' },
];

const EBAY_AU = {
  store: 'eBay AU',
  searchUrl: (q) =>
    `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(q + ' board game')}&_sacat=233&LH_BIN=1&_sop=15`,
};

const SKIP_WORDS = [
  'expansion', 'promo', 'sleeve', 'insert', 'nesting box',
  'pack', 'upgrade', 'playmat', 'organizer', 'organiser', 'dice',
  'mini', 'token', 'replacement', 'damaged', 'used',
];

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
  const cacheKey = `bgg_prices_${gameId}`;
  const cached = await getFromCache(cacheKey, 60 * 60 * 1000);
  if (cached?.prices?.length > 0) {
    console.log('BGG AU: cached prices for', gameId);
    return cached;
  }

  console.log('BGG AU: fetching prices for', gameName);
  const result = await fetchAllPrices(gameName);

  if (result.prices.length > 0) {
    await setInCache(cacheKey, result);
  }
  return result;
}

async function fetchAllPrices(gameName) {
  const [shopifyResults, ebayResult] = await Promise.all([
    fetchShopifyPrices(gameName).catch((err) => {
      console.warn('BGG AU: Shopify error:', err.message);
      return [];
    }),
    fetchEbayAU(gameName).catch((err) => {
      console.warn('BGG AU: eBay error:', err.message);
      return null;
    }),
  ]);

  const prices = [...shopifyResults];
  if (ebayResult) prices.push(ebayResult);

  // Sort cheapest first
  prices.sort((a, b) => a.price - b.price);

  console.log('BGG AU: found', prices.length, 'prices');
  return { success: true, prices };
}

// --- Shopify AU Stores ---

async function fetchShopifyPrices(gameName) {
  const nameWords = gameName.toLowerCase().split(/\s+/);
  const nameLower = gameName.toLowerCase();

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

        // All search words must appear in title
        if (!nameWords.every((w) => title.includes(w))) continue;

        // Skip accessories/expansions
        if (SKIP_WORDS.some((sw) => title.includes(sw))) continue;

        // Game name must appear near the start of the title (within first 40 chars)
        const namePos = title.indexOf(nameLower);
        if (namePos > 40) continue;

        // Reject franchise spin-offs: colon after game name = different game
        // e.g. "Catan: Starfarers", "Catan: Cities & Knights"
        const afterName = title.substring(namePos + nameLower.length).trim();
        if (afterName.startsWith(':') || afterName.startsWith('–') || afterName.startsWith('—')) continue;

        const price = parseFloat(product.price);
        if (!price || price < 5 || price > 500) continue;

        const productUrl = product.url
          ? config.baseUrl + product.url.split('?')[0]
          : null;

        // Score: prefer "base game" in title, then shortest title as tiebreaker
        const score = (title.includes('base') ? 1000 : 0) - title.length;

        if (!bestMatch || score > bestMatch._score) {
          bestMatch = {
            store: config.store,
            price,
            url: productUrl,
            inStock: product.available !== false,
            _score: score,
          };
        }
      }

      if (bestMatch) {
        delete bestMatch._score;
        return bestMatch;
      }
      return null;
    } catch (err) {
      console.log('BGG AU:', config.store, 'failed:', err.message);
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

// --- eBay AU ---

async function fetchEbayAU(gameName) {
  const nameWords = gameName.toLowerCase().split(/\s+/);
  const nameLower = gameName.toLowerCase();

  try {
    const url = EBAY_AU.searchUrl(gameName);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html', 'Accept-Language': 'en-AU,en;q=0.9' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;

    const html = await resp.text();
    return parseEbayHtml(html, nameWords, nameLower);
  } catch (err) {
    console.log('BGG AU: eBay AU failed:', err.message);
    return null;
  }
}

function parseEbayHtml(html, nameWords, nameLower) {
  const itemPattern =
    /href=(https?:\/\/(?:www\.)?ebay\.com\.au\/itm\/(\d+)[^\s>]*)/g;
  const items = [];
  const seenIds = new Set();
  let match;

  while ((match = itemPattern.exec(html)) !== null) {
    const itemId = match[2];
    if (seenIds.has(itemId)) continue;
    seenIds.add(itemId);

    const itemUrl = match[1].split('?')[0];
    const chunk = html.substring(
      match.index,
      Math.min(html.length, match.index + 2000)
    );

    // Extract title
    const titleMatch = chunk.match(
      /s-card__title[^>]*>(?:<span[^>]*>)?\s*([^<]+)/
    );
    if (!titleMatch) continue;
    const title = titleMatch[1].trim().toLowerCase();

    // All name words must appear
    if (!nameWords.every((w) => title.includes(w))) continue;

    // Skip accessories/expansions
    if (SKIP_WORDS.some((w) => title.includes(w))) continue;

    // Game name must appear near the start of the title
    const namePos = title.indexOf(nameLower);
    if (namePos > 40) continue;

    // Reject franchise spin-offs (colon after game name = different game)
    const afterName = title.substring(namePos + nameLower.length).trim();
    if (afterName.startsWith(':') || afterName.startsWith('–') || afterName.startsWith('—')) continue;

    // Extract price
    const priceMatch = chunk.match(
      /s-card__price[^>]*>\s*(?:AU?\s*\$|\$)\s*([\d,.]+)/
    );
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!price || price < 5 || price > 500) continue;

    items.push({ url: itemUrl, price });
  }

  if (items.length === 0) return null;

  // Return cheapest
  items.sort((a, b) => a.price - b.price);
  return {
    store: EBAY_AU.store,
    price: items[0].price,
    url: items[0].url,
    inStock: true,
  };
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
    console.warn('BGG AU: BGG API failed:', err.message);
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

  return {
    id: gameId,
    name: name ? decodeXmlEntities(name) : 'Unknown',
    rating: rating ? parseFloat(parseFloat(rating).toFixed(1)) : 0,
    weight: weight ? parseFloat(parseFloat(weight).toFixed(1)) : 0,
    year: year ? parseInt(year) : 0,
    minPlayers: minP ? parseInt(minP) : 0,
    maxPlayers: maxP ? parseInt(maxP) : 0,
    playingTime: time ? parseInt(time) : 0,
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

// --- Cache Helpers ---

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
