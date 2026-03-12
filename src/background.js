// Background worker: fetch store data, score matches, cache the result.

// Matching logic changed, so bump cache version and avoid stale picks.
const CACHE_VERSION = 20;

// New version means old cache entries are no longer trusted.
chrome.storage.local.get('bgg_cache_version', (result) => {
  if (result.bgg_cache_version !== CACHE_VERSION) {
    console.log('BGG AU: cache version changed, clearing old data');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ bgg_cache_version: CACHE_VERSION });
    });
  }
});

// --- Store Config ---

const SHOPIFY_STORES = [
  { store: 'Gameology', baseUrl: 'https://www.gameology.com.au' },
  { store: 'GUF', baseUrl: 'https://www.guf.com.au' },
  { store: 'Board Game Master', baseUrl: 'https://www.boardgamemaster.com.au' },
  { store: 'Games Empire', baseUrl: 'https://www.gamesempire.com.au' },
  { store: 'Good Games', baseUrl: 'https://www.goodgames.com.au' },
  // Vault Games is also on Shopify, so it slots into the existing fetch path without extra scraper code.
  { store: 'Vault Games', baseUrl: 'https://vaultgames.com.au' },
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

// These words are usually harmless after a game title.
// Unknown tails get penalized because they're often a different product.
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
let hasLoggedBggApi401 = false;
const NUMBER_WORD_TO_DIGIT = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

// --- Message Bus ---

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

// --- Price Fetch ---

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

  // UI expects rows sorted by lowest price first.
  prices.sort((a, b) => a.price - b.price);

  console.log('BGG AU: found', prices.length, 'prices');
  return { success: true, prices };
}

// Normalize punctuation/case so title scoring is consistent.
function cleanText(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function tokenize(cleaned) {
  return cleaned.split(/\s+/).filter((w) => w.length > 0);
}

function getSignificantTokens(cleaned) {
  return tokenize(cleaned).filter((w) => !MATCH_STOP_WORDS.has(w));
}

// Stores often drop subtitles. Keep both full and primary title forms for fallback scoring.
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
    volumeNumber: extractVolumeNumber(full),
    hasLegacySettlersAlias:
      fullTokens.length === 1 &&
      full === 'catan',
  };
}

function normalizeNumberToken(token) {
  const raw = (token || '').toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  if (NUMBER_WORD_TO_DIGIT[raw]) return NUMBER_WORD_TO_DIGIT[raw];
  return null;
}

// If both titles mention volume, they need to agree.
function extractVolumeNumber(cleanedText) {
  const tokens = tokenize(cleanedText);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token !== 'volume' && token !== 'vol') continue;

    const next = normalizeNumberToken(tokens[i + 1]);
    if (next) return next;
  }
  return null;
}

// Exact long-title queries can fail on store search APIs.
// We try a few shorter, deduplicated variants and then stop.
function buildSearchQueries(gameName, profile) {
  const queries = [];
  const seen = new Set();

  const add = (query) => {
    const raw = (query || '').trim();
    if (!raw) return;

    const normalized = cleanText(raw);
    if (!normalized || seen.has(normalized)) return;

    seen.add(normalized);
    queries.push(raw);
  };

  add(gameName);
  add(profile.full);

  if (profile.fullTokens.length >= 3) {
    add(profile.fullTokens.slice(0, 3).join(' '));
  }

  if (profile.fullTokens.length >= 4) {
    add(profile.fullTokens.slice(0, 4).join(' '));
  }

  if (profile.fullTokens.length <= 2) {
    add(profile.primary);
  }

  return queries.slice(0, 4);
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

function getTrailingWordStats(cleanedTitle, profile) {
  const primaryPos = cleanedTitle.indexOf(profile.primary);
  if (primaryPos < 0) return { penalty: 0, unsafeCount: 0 };

  const afterPrimary = cleanedTitle
    .substring(primaryPos + profile.primary.length)
    .trim();
  if (!afterPrimary) return { penalty: 0, unsafeCount: 0 };

  const afterWords = tokenize(afterPrimary);
  let penalty = 0;
  let unsafeCount = 0;
  for (const word of afterWords) {
    if (
      SAFE_TITLE_WORDS.has(word) ||
      profile.fullTokenSet.has(word) ||
      /^\d+\w*$/.test(word)
    ) {
      continue;
    }
    unsafeCount += 1;
    penalty += 140;
  }
  return { penalty, unsafeCount };
}

// Matcher strategy:
// strict for short names ("Catan"), more forgiving for long subtitle-heavy titles.
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

  const containsFull =
    !!profile.full && (` ${cleanedTitle} `).includes(` ${profile.full} `);
  const containsPrimary =
    !!profile.primary && (` ${cleanedTitle} `).includes(` ${profile.primary} `);
  const startsWithPrimary =
    !!profile.primary && cleanedTitle.startsWith(profile.primary);
  const threshold = getCoverageThreshold(profile.fullTokens.length);
  const trailingStats = getTrailingWordStats(cleanedTitle, profile);
  const titleVolumeNumber = extractVolumeNumber(cleanedTitle);

  // If the game is Volume One, don't return Volume 2/3 listings.
  if (
    profile.volumeNumber &&
    titleVolumeNumber &&
    profile.volumeNumber !== titleVolumeNumber
  ) {
    return null;
  }

  // Short names are risky. Extra unknown suffix words usually mean the wrong game.
  if (
    profile.fullTokens.length <= 2 &&
    startsWithPrimary &&
    trailingStats.unsafeCount > 0
  ) {
    return null;
  }

  // Reject reverse-form titles like "Struggle for Catan" when matching plain "Catan".
  if (
    profile.fullTokens.length <= 2 &&
    containsFull &&
    !startsWithPrimary
  ) {
    const hasLegacyAlias =
      profile.hasLegacySettlersAlias &&
      cleanedTitle.includes('settlers of catan');
    if (!hasLegacyAlias) return null;

    // Keep legacy "Settlers of Catan" support, but block obvious variants
    // like "Junior" or "Dice" when the query is just "Catan".
    const aliasText = 'settlers of catan';
    const aliasPos = cleanedTitle.indexOf(aliasText);
    const afterAlias =
      aliasPos >= 0
        ? cleanedTitle.substring(aliasPos + aliasText.length).trim()
        : '';
    const aliasTrailingWords = tokenize(afterAlias);
    const hasUnsafeAliasSuffix = aliasTrailingWords.some(
      (word) =>
        !SAFE_TITLE_WORDS.has(word) &&
        !profile.fullTokenSet.has(word) &&
        !/^\d+\w*$/.test(word)
    );
    if (hasUnsafeAliasSuffix) return null;
  }

  const longNameFallback =
    profile.fullTokens.length >= 7 &&
    primaryCoverage >= 0.8 &&
    fullCoverage >= 0.45;
  const subtitleFallback =
    profile.fullTokens.length >= 5 &&
    startsWithPrimary &&
    primaryCoverage >= 0.8 &&
    fullCoverage >= 0.55;
  const shortNamePrimaryMatch =
    profile.fullTokens.length <= 2 &&
    startsWithPrimary &&
    primaryCoverage >= 0.8;

  const matched =
    containsFull ||
    shortNamePrimaryMatch ||
    subtitleFallback ||
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
  score -= trailingStats.penalty;
  score -= cleanedTitle.length;

  return {
    score,
    fullCoverage,
    primaryCoverage,
    containsFull,
    startsWithPrimary,
  };
}

function parseMoneyValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw =
    typeof value === 'string'
      ? value
      : value?.amount ?? value?.value ?? null;
  if (raw == null) return null;

  const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

// Shopify is the only source we trust for sale state right now because compare-at pricing
// usually comes through in the search payload instead of forcing us to guess from title text.
function extractShopifySaleInfo(product, currentPrice) {
  const compareCandidates = [
    product.compare_at_price,
    product.compare_at_price_min,
    product.compare_at_price_max,
    product.compare_at_price_range?.max,
    product.compare_at_price_range?.min,
  ]
    .map(parseMoneyValue)
    .filter((price) => price && price > currentPrice);

  if (compareCandidates.length === 0) {
    return {
      onSale: false,
      originalPrice: null,
      saleLabel: null,
    };
  }

  const originalPrice = Math.max(...compareCandidates);
  const savings = originalPrice - currentPrice;
  const discountPct = Math.round((savings / originalPrice) * 100);
  const saleLabel =
    discountPct >= 5
      ? `${discountPct}% off`
      : `Save A$${savings.toFixed(2)}`;

  return {
    onSale: true,
    originalPrice,
    saleLabel,
  };
}

// --- Shopify Stores ---

async function fetchShopifyPrices(gameName) {
  const profile = buildGameMatchProfile(gameName);
  const searchQueries = buildSearchQueries(gameName, profile);

  const promises = SHOPIFY_STORES.map(async (config) => {
    try {
      let bestMatch = null;
      const seenProductIds = new Set();

      for (const searchQuery of searchQueries) {
        try {
          const url = `${config.baseUrl}/search/suggest.json?q=${encodeURIComponent(searchQuery)}&resources[type]=product&resources[limit]=8`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);

          const resp = await fetch(url, { signal: controller.signal });
          clearTimeout(timeout);
          if (!resp.ok) continue;

          const data = await resp.json();
          const products = data?.resources?.results?.products || [];

          for (const product of products) {
            const productId = String(
              product.id || product.handle || product.url || product.title || ''
            );
            if (productId && seenProductIds.has(productId)) continue;
            if (productId) seenProductIds.add(productId);

            const match = evaluateTitleMatch(product.title, profile);
            if (!match) continue;

            const price = parseFloat(product.price);
            if (!price || price < 5 || price > 500) continue;
            const saleInfo = extractShopifySaleInfo(product, price);

            const productUrl = product.url
              ? config.baseUrl + product.url.split('?')[0]
              : null;

            let score = match.score;
            if ((product.title || '').toLowerCase().includes('base')) score += 120;

            if (!bestMatch || score > bestMatch._score) {
              bestMatch = {
                store: config.store,
                price,
                originalPrice: saleInfo.originalPrice,
                onSale: saleInfo.onSale,
                saleLabel: saleInfo.saleLabel,
                url: productUrl,
                inStock: product.available !== false,
                _score: score,
              };
            }
          }
        } catch (queryErr) {
          console.log(
            'BGG AU:',
            config.store,
            'query failed:',
            searchQuery,
            queryErr.message
          );
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
  // eBay href values can be quoted or unquoted; support both.
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

    // Pull listing title from the nearby HTML chunk.
    const titleMatch = chunk.match(
      /s-card__title[^>]*>(?:<span[^>]*>)?\s*([^<]+)/
    );
    if (!titleMatch) continue;
    const matchDetails = evaluateTitleMatch(titleMatch[1], profile);
    if (!matchDetails) continue;
    // eBay is noisy. If full title isn't present, require stronger confidence.
    if (!matchDetails.containsFull && matchDetails.primaryCoverage < 0.85) {
      continue;
    }

    // Pull price and filter obvious junk values.
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

  // Confidence first, then price as a tie-breaker.
  items.sort((a, b) => b.score - a.score || a.price - b.price);
  return {
    store: EBAY_AU.store,
    price: items[0].price,
    url: items[0].url,
    inStock: true,
  };
}

// --- BGG Game Data ---

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
    if (!resp.ok) {
      if (resp.status === 401) {
        if (!hasLoggedBggApi401) {
          console.info(
            'BGG AU: BGG API returned 401, so game stats are temporarily unavailable.'
          );
          hasLoggedBggApi401 = true;
        }
        return { success: false, game: null, error: 'BGG API 401' };
      }
      throw new Error(`BGG API ${resp.status}`);
    }

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
  // BGG occasionally returns non-numeric fields (for example "N/A").
  // Coerce to zero so the panel never renders NaN.
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
