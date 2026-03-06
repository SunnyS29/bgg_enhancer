// BGG Price Compare AU — Background Service Worker

// Bump when matching behavior changes so stale cached prices don't hide new logic.
const CACHE_VERSION = 17;

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
  'expansion', 'extension', 'promo', 'sleeve', 'insert', 'nesting box',
  'pack', 'upgrade', 'playmat', 'organizer', 'organiser', 'dice',
  'mini', 'token', 'replacement', 'damaged', 'used', 'scenario',
];

// Words that legitimately appear after a game name in product titles
// Anything NOT in this set = likely a different game (e.g. "Starfarers", "Duel")
const SAFE_TITLE_WORDS = new Set([
  'edition', 'base', 'game', 'board', 'the', 'a', 'an', 'of', 'and', 'in',
  'standard', 'core', 'classic', 'revised', 'new', 'original', 'updated',
  'complete', 'definitive', 'set', 'version', 'starter', 'anniversary',
  'player', 'players', 'deluxe', 'collector', 'collectors', 'collection',
  'big', 'box', 'mega', 'ultimate', 'essential', 'essentials',
]);
const MATCH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'for', 'to', 'on', 'at', 'with',
  'board', 'game',
]);

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

// Strip punctuation for cleaner matching (handles "Unmatched: Battle of Legends, Volume One")
function cleanText(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(cleaned) {
  return cleaned.split(/\s+/).filter((w) => w.length > 0);
}

function getSignificantTokens(cleaned) {
  return tokenize(cleaned).filter((w) => !MATCH_STOP_WORDS.has(w));
}

// Long BGG titles often include subtitles stores omit; keep both full title and a primary segment for fallback matching.
function buildGameMatchProfile(gameName) {
  const full = cleanText(gameName || '');
  const primaryRaw = (gameName || '').split(/[:|–—]/)[0];
  const primary = cleanText(primaryRaw || gameName || '');

  let fullTokens = getSignificantTokens(full);
  let primaryTokens = getSignificantTokens(primary);

  if (fullTokens.length === 0) fullTokens = tokenize(full);
  if (primaryTokens.length === 0) primaryTokens = tokenize(primary);

  const fullTokenSet = new Set(fullTokens);
  const anchorToken =
    [...new Set(primaryTokens)].sort((a, b) => b.length - a.length)[0] ||
    [...new Set(fullTokens)].sort((a, b) => b.length - a.length)[0] ||
    null;

  return {
    full,
    primary: primary || full,
    fullTokens,
    primaryTokens,
    fullTokenSet,
    anchorToken,
  };
}

function tokenCoverage(queryTokens, titleTokenSet) {
  if (!queryTokens.length) return 0;
  const hits = queryTokens.reduce(
    (count, token) => count + (titleTokenSet.has(token) ? 1 : 0),
    0
  );
  return hits / queryTokens.length;
}

function getCoverageThreshold(tokenCount) {
  if (tokenCount <= 2) return 1;
  if (tokenCount <= 4) return 0.85;
  if (tokenCount <= 6) return 0.75;
  if (tokenCount <= 9) return 0.65;
  return 0.55;
}

function trailingWordPenalty(cleanedTitle, profile) {
  const primaryPos = cleanedTitle.indexOf(profile.primary);
  if (primaryPos < 0) return 0;

  const afterPrimary = cleanedTitle
    .substring(primaryPos + profile.primary.length)
    .trim();
  if (!afterPrimary) return 0;

  const afterWords = tokenize(afterPrimary);
  let penalty = 0;
  for (const word of afterWords) {
    if (
      SAFE_TITLE_WORDS.has(word) ||
      profile.fullTokenSet.has(word) ||
      /^\d+\w*$/.test(word)
    ) {
      continue;
    }
    penalty += 140;
  }
  return penalty;
}

// Adaptive matcher:
// - strict on short names
// - allows partial fallback on long/specific names where stores omit subtitle segments
function evaluateTitleMatch(rawTitle, profile) {
  const cleanedTitle = cleanText(rawTitle || '');
  if (!cleanedTitle) return null;

  if (SKIP_WORDS.some((sw) => cleanedTitle.includes(sw))) return null;
  if (profile.anchorToken && !cleanedTitle.includes(profile.anchorToken)) {
    return null;
  }

  const titleTokenSet = new Set(tokenize(cleanedTitle));
  const fullCoverage = tokenCoverage(profile.fullTokens, titleTokenSet);
  const primaryCoverage = tokenCoverage(profile.primaryTokens, titleTokenSet);

  const containsFull = !!profile.full && cleanedTitle.includes(profile.full);
  const containsPrimary = !!profile.primary && cleanedTitle.includes(profile.primary);
  const startsWithPrimary =
    !!profile.primary && cleanedTitle.startsWith(profile.primary);
  const threshold = getCoverageThreshold(profile.fullTokens.length);

  const longNameFallback =
    profile.fullTokens.length >= 7 &&
    primaryCoverage >= 0.8 &&
    fullCoverage >= 0.45;

  const matched =
    containsFull ||
    (startsWithPrimary && primaryCoverage >= 0.8) ||
    (fullCoverage >= threshold &&
      primaryCoverage >= Math.max(0.6, threshold - 0.15)) ||
    longNameFallback;

  if (!matched) return null;

  let score = 0;
  score += Math.round(fullCoverage * 1000);
  score += Math.round(primaryCoverage * 800);
  if (containsFull) score += 900;
  if (startsWithPrimary) {
    score += 450;
  } else if (containsPrimary) {
    score += 220;
  }
  score -= trailingWordPenalty(cleanedTitle, profile);
  score -= cleanedTitle.length;

  return {
    score,
    fullCoverage,
    primaryCoverage,
    containsFull,
    startsWithPrimary,
  };
}

// --- Shopify AU Stores ---

async function fetchShopifyPrices(gameName) {
  const profile = buildGameMatchProfile(gameName);

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
        const match = evaluateTitleMatch(product.title, profile);
        if (!match) continue;

        const price = parseFloat(product.price);
        if (!price || price < 5 || price > 500) continue;

        const productUrl = product.url
          ? config.baseUrl + product.url.split('?')[0]
          : null;

        let score = match.score;
        if ((product.title || '').toLowerCase().includes('base')) score += 120;

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
  const profile = buildGameMatchProfile(gameName);

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
    return parseEbayHtml(html, profile);
  } catch (err) {
    console.log('BGG AU: eBay AU failed:', err.message);
    return null;
  }
}

function parseEbayHtml(html, profile) {
  // eBay markup can emit href with quotes (href="...") or without; support both so items are detected reliably.
  const itemPattern =
    /href=["']?(https?:\/\/(?:www\.)?ebay\.com\.au\/itm\/(\d+)[^"'\s>]*)/g;
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
    const matchDetails = evaluateTitleMatch(titleMatch[1], profile);
    if (!matchDetails) continue;
    // eBay listings are noisy; require stronger confidence when full title does not appear verbatim.
    if (!matchDetails.containsFull && matchDetails.primaryCoverage < 0.85) {
      continue;
    }

    // Extract price
    const priceMatch = chunk.match(
      /s-card__price[^>]*>\s*(?:AU?\s*\$|\$)\s*([\d,.]+)/
    );
    if (!priceMatch) continue;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (!price || price < 5 || price > 500) continue;

    items.push({
      url: itemUrl,
      price,
      score: matchDetails.score - Math.round(price),
    });
  }

  if (items.length === 0) return null;

  // Prefer best title match first, then cheaper price as tie-breaker.
  items.sort((a, b) => b.score - a.score || a.price - b.price);
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
  // BGG sometimes returns non-numeric values (for example "N/A"); coerce those to 0 to avoid rendering NaN.
  const toOneDecimalOrZero = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? parseFloat(n.toFixed(1)) : 0;
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
    rating: toOneDecimalOrZero(rating),
    weight: toOneDecimalOrZero(weight),
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
