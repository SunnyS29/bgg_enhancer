// BGG Enhancer — Cloudflare Worker Backend

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/prices') {
        return handlePrices(url, env);
      }
      if (path.startsWith('/api/game/')) {
        return handleGame(path, env);
      }
      if (path.startsWith('/api/collection/')) {
        return handleCollection(path, env);
      }
      if (path === '/health') {
        return jsonResponse({ status: 'ok', version: '1.0.0' });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};

// --- Price endpoint ---

async function handlePrices(url, env) {
  const gameName = url.searchParams.get('game');
  if (!gameName) {
    return jsonResponse({ error: 'Missing "game" parameter' }, 400);
  }

  const cacheKey = `prices:${gameName.toLowerCase().trim()}`;
  const cached = await getCached(cacheKey, env);
  if (cached) return jsonResponse(cached);

  const prices = [];

  // Amazon via RapidAPI
  if (env.RAPIDAPI_KEY) {
    try {
      const amazonPrices = await fetchAmazonPrices(gameName, env.RAPIDAPI_KEY);
      prices.push(...amazonPrices);
    } catch (err) {
      console.error('Amazon API error:', err);
    }
  }

  // Add store search links for other stores (direct search URLs)
  const encoded = encodeURIComponent(gameName + ' board game');
  prices.push(
    ...getStoreSearchLinks(gameName, encoded, prices)
  );

  const result = {
    success: true,
    prices: prices.length > 0 ? prices : getSearchLinks(gameName),
    demo: prices.length === 0,
  };

  await setCached(cacheKey, result, env);
  return jsonResponse(result);
}

async function fetchAmazonPrices(gameName, apiKey) {
  const resp = await fetch(
    `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(gameName + ' board game')}&country=US&category_id=aps`,
    {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'real-time-amazon-data.p.rapidapi.com',
      },
    }
  );

  if (!resp.ok) throw new Error(`Amazon API ${resp.status}`);
  const data = await resp.json();

  if (!data.data?.products?.length) return [];

  // Take the first relevant result
  const product = data.data.products[0];
  const price = parseFloat(
    (product.product_price || '').replace(/[^0-9.]/g, '')
  );

  if (!price || isNaN(price)) return [];

  return [
    {
      store: 'Amazon',
      price,
      url: product.product_url || `https://www.amazon.com/s?k=${encodeURIComponent(gameName + ' board game')}`,
      inStock: !product.is_out_of_stock,
    },
  ];
}

const ALL_STORES = [
  // US Stores
  { store: 'Amazon', region: 'US', urlTemplate: 'https://www.amazon.com/s?k={q}+board+game' },
  { store: 'CoolStuffInc', region: 'US', urlTemplate: 'https://www.coolstuffinc.com/main_search.php?pa=searchOnName&token={q}' },
  { store: 'MiniatureMarket', region: 'US', urlTemplate: 'https://www.miniaturemarket.com/searchresults?q={q}' },
  { store: 'GameNerdz', region: 'US', urlTemplate: 'https://www.gamenerdz.com/catalogsearch/result/?q={q}' },
  { store: 'Boardlandia', region: 'US', urlTemplate: 'https://boardlandia.com/search?q={q}' },
  { store: 'Target', region: 'US', urlTemplate: 'https://www.target.com/s?searchTerm={q}+board+game' },
  { store: 'Walmart', region: 'US', urlTemplate: 'https://www.walmart.com/search?q={q}+board+game' },
  { store: 'Barnes & Noble', region: 'US', urlTemplate: 'https://www.barnesandnoble.com/s/{q}+board+game' },
  { store: 'eBay', region: 'US', urlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={q}+board+game' },
  // Australian Stores
  { store: 'Amazon AU', region: 'AU', urlTemplate: 'https://www.amazon.com.au/s?k={q}+board+game' },
  { store: 'Games Empire', region: 'AU', urlTemplate: 'https://www.gamesempire.com.au/search?q={q}' },
  { store: 'Gameology', region: 'AU', urlTemplate: 'https://www.gameology.com.au/search?q={q}' },
  { store: 'Board Game Master', region: 'AU', urlTemplate: 'https://www.boardgamemaster.com.au/search?q={q}' },
  { store: 'Guf', region: 'AU', urlTemplate: 'https://www.guf.com.au/search?q={q}' },
  { store: 'Advent Games', region: 'AU', urlTemplate: 'https://www.adventgames.com.au/search?q={q}' },
  { store: 'eBay AU', region: 'AU', urlTemplate: 'https://www.ebay.com.au/sch/i.html?_nkw={q}+board+game' },
];

function getStoreSearchLinks(gameName, encoded, existingPrices) {
  const hasStore = new Set(existingPrices.map((p) => p.store));
  const q = encodeURIComponent(gameName);

  return ALL_STORES
    .filter((s) => !hasStore.has(s.store))
    .map((s) => ({
      store: s.store,
      region: s.region,
      price: null,
      url: s.urlTemplate.replace('{q}', q),
      inStock: true,
      searchLink: true,
    }));
}

function getSearchLinks(gameName) {
  const q = encodeURIComponent(gameName);

  return ALL_STORES.map((s) => ({
    store: s.store,
    region: s.region,
    price: null,
    url: s.urlTemplate.replace('{q}', q),
    inStock: true,
    searchLink: true,
  }));
}

// --- Game data endpoint ---

async function handleGame(path, env) {
  const gameId = path.replace('/api/game/', '');
  if (!gameId || !/^\d+$/.test(gameId)) {
    return jsonResponse({ error: 'Invalid game ID' }, 400);
  }

  const cacheKey = `game:${gameId}`;
  const cached = await getCached(cacheKey, env, 6 * 60 * 60);
  if (cached) return jsonResponse(cached);

  try {
    const resp = await fetch(
      `https://boardgamegeek.com/xmlapi2/thing?id=${gameId}&stats=1`
    );
    if (!resp.ok) throw new Error(`BGG API ${resp.status}`);

    const xml = await resp.text();
    const game = parseGameXml(xml, gameId);

    const result = { success: true, game };
    await setCached(cacheKey, result, env, 6 * 60 * 60);
    return jsonResponse(result);
  } catch (err) {
    console.error('BGG game API error:', err);
    return jsonResponse({ success: false, error: err.message }, 502);
  }
}

function parseGameXml(xml, gameId) {
  // Simple XML parsing without DOMParser (not available in Workers)
  const get = (tag, attr) => {
    const re = attr
      ? new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i')
      : new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
    const m = xml.match(re);
    return m ? m[1] : null;
  };

  const getVal = (tag) => {
    const re = new RegExp(`<${tag}[^>]*value="([^"]*)"`, 'i');
    const m = xml.match(re);
    return m ? m[1] : null;
  };

  // Get primary name
  const nameMatch = xml.match(/<name\s+type="primary"[^>]*value="([^"]*)"/i);
  const name = nameMatch ? nameMatch[1] : 'Unknown';

  // Get rating
  const ratingMatch = xml.match(/<average[^>]*value="([^"]*)"/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]).toFixed(1) : null;

  // Get weight
  const weightMatch = xml.match(/<averageweight[^>]*value="([^"]*)"/i);
  const weight = weightMatch ? parseFloat(weightMatch[1]).toFixed(1) : null;

  // Get image
  const imageMatch = xml.match(/<image>([^<]+)<\/image>/i);
  const image = imageMatch ? imageMatch[1] : null;

  return {
    id: gameId,
    name,
    rating: rating ? parseFloat(rating) : 7.0,
    weight: weight ? parseFloat(weight) : 2.5,
    year: parseInt(getVal('yearpublished')) || 2020,
    minPlayers: parseInt(getVal('minplayers')) || 2,
    maxPlayers: parseInt(getVal('maxplayers')) || 4,
    playingTime: parseInt(getVal('playingtime')) || 60,
    image,
  };
}

// --- Collection endpoint ---

async function handleCollection(path, env) {
  const username = decodeURIComponent(path.replace('/api/collection/', ''));
  if (!username) {
    return jsonResponse({ error: 'Missing username' }, 400);
  }

  const cacheKey = `collection:${username.toLowerCase()}`;
  const cached = await getCached(cacheKey, env, 30 * 60);
  if (cached) return jsonResponse(cached);

  try {
    const resp = await fetch(
      `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1&wishlist=1&prevowned=1&want=1&brief=1`
    );

    // BGG returns 202 while processing, need to retry
    if (resp.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      const retry = await fetch(
        `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1&wishlist=1&prevowned=1&want=1&brief=1`
      );
      if (!retry.ok) throw new Error(`BGG API ${retry.status}`);
      const xml = await retry.text();
      const collection = parseCollectionXml(xml);
      const result = { success: true, collection };
      await setCached(cacheKey, result, env, 30 * 60);
      return jsonResponse(result);
    }

    if (!resp.ok) throw new Error(`BGG API ${resp.status}`);
    const xml = await resp.text();
    const collection = parseCollectionXml(xml);

    const result = { success: true, collection };
    await setCached(cacheKey, result, env, 30 * 60);
    return jsonResponse(result);
  } catch (err) {
    console.error('BGG collection API error:', err);
    return jsonResponse({ success: true, collection: {}, error: err.message });
  }
}

function parseCollectionXml(xml) {
  const collection = {};
  const itemRegex = /<item\s+objecttype="thing"\s+objectid="(\d+)"[^>]*>[\s\S]*?<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const gameId = match[1];
    const block = match[0];

    const own = /own="1"/.test(block);
    const wishlist = /wishlist="1"/.test(block);
    const prevowned = /prevowned="1"/.test(block);
    const want = /want="1"/.test(block);

    let status = null;
    let label = null;

    if (own) { status = 'own'; label = 'Owned'; }
    else if (wishlist) { status = 'wishlist'; label = 'Wishlist'; }
    else if (want) { status = 'wanttobuy'; label = 'Want to Buy'; }
    else if (prevowned) { status = 'prevowned'; label = 'Prev. Owned'; }

    if (status) {
      collection[gameId] = { status, label };
    }
  }

  return collection;
}

// --- Helpers ---

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// Simple in-memory cache (per worker instance)
const memCache = new Map();

async function getCached(key, env, ttlSeconds = 3600) {
  const entry = memCache.get(key);
  if (entry && Date.now() - entry.ts < ttlSeconds * 1000) {
    return entry.data;
  }
  return null;
}

async function setCached(key, data, env, ttlSeconds = 3600) {
  memCache.set(key, { data, ts: Date.now() });
  // Prevent unbounded cache growth
  if (memCache.size > 500) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
}
