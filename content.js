// BGG Enhancer — Content Script (runs on BGG game pages)

(function () {
  'use strict';

  const LOG_PREFIX = '[BGG Enhancer]';
  let currentGameId = null;
  let panelInjected = false;

  // --- Entry point: wait for BGG to render, then inject ---
  init();

  function init() {
    console.log(LOG_PREFIX, 'Content script loaded on', window.location.href);

    const parsed = parseBggUrl();
    if (!parsed) {
      console.log(LOG_PREFIX, 'Not a game page URL, skipping.');
      return;
    }

    currentGameId = parsed.gameId;
    console.log(LOG_PREFIX, 'Detected game ID:', currentGameId);

    // Try immediately, then observe for changes
    attemptInjection();
    observePageChanges();
    watchForSpaNavigation();
  }

  // --- Attempt to inject the panel (retries until page is ready) ---
  function attemptInjection() {
    if (panelInjected) return;

    const gameName = getGameNameFromDom() || getGameNameFromTitle();
    if (!gameName) {
      console.log(LOG_PREFIX, 'Game name not found yet, waiting...');
      return;
    }

    console.log(LOG_PREFIX, 'Game name found:', gameName);
    panelInjected = true;

    chrome.runtime.sendMessage({ action: 'trackView', gameId: currentGameId });

    const container = createPanelContainer();
    renderLoadingState(container);
    fetchAndRender(container, currentGameId, gameName);
  }

  // --- Get game name from the DOM (multiple strategies) ---
  function getGameNameFromDom() {
    const selectors = [
      // Modern BGG selectors
      'h1 a',
      'h1',
      '.game-header-title-info a',
      '.game-header-title-info h1',
      '[data-objectid] h1',
      '.geekitem_title a',
      '.geekitem_title',
      // Older BGG selectors
      '#mainbody h1 a',
      '#mainbody h1',
      '.game_header_title_info a',
      // Very generic fallbacks
      'meta[property="og:title"]',
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = sel.startsWith('meta')
            ? el.getAttribute('content')
            : el.textContent;
          const cleaned = text?.trim().replace(/\s+/g, ' ');
          if (cleaned && cleaned.length > 0 && cleaned.length < 200) {
            return cleaned;
          }
        }
      } catch (e) { /* skip invalid selector */ }
    }

    return null;
  }

  // --- Get game name from page title (reliable fallback) ---
  function getGameNameFromTitle() {
    const title = document.title;
    if (!title) return null;

    // BGG titles are like "Catan | Board Game | BoardGameGeek"
    // or "Catan – Board Game – BoardGameGeek"
    const cleaned = title
      .split(/[|\u2013\u2014\u2015\u2212–—-]/)[0]
      .trim();

    if (cleaned && cleaned !== 'BoardGameGeek' && cleaned.length > 0 && cleaned.length < 200) {
      return cleaned;
    }
    return null;
  }

  // --- Create floating panel (always visible, independent of BGG layout) ---
  function createPanelContainer() {
    // Remove existing panel if any
    const existing = document.getElementById('bgg-enhancer-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'bgg-enhancer-panel';
    panel.classList.add('bgge-floating');
    document.body.appendChild(panel);
    console.log(LOG_PREFIX, 'Floating panel created');
    return panel;
  }

  // --- Fetch data and render ---
  async function fetchAndRender(container, gameId, gameName) {
    const settings = await getSettings();

    // Fetch game data directly from BGG (same-origin, no CORS issues)
    // Fetch prices from background worker (needs service worker for cross-origin)
    const [priceResult, gameResult, collectionResult] = await Promise.all([
      sendMessage({ action: 'fetchPrices', gameName, gameId }),
      fetchGameDataDirect(gameId),
      settings.bggUsername
        ? sendMessage({ action: 'fetchCollection', username: settings.bggUsername })
        : Promise.resolve({ success: true, collection: {} }),
    ]);

    console.log(LOG_PREFIX, 'Data fetched:', {
      prices: priceResult?.prices?.length || 0,
      game: gameResult?.game?.name,
      gameRating: gameResult?.game?.rating,
      gamePlayers: gameResult?.game ? `${gameResult.game.minPlayers}-${gameResult.game.maxPlayers}` : 'N/A',
      demo: priceResult?.demo,
    });

    const ownershipStatus = getOwnershipStatus(gameId, collectionResult);

    renderPanel(container, {
      gameId,
      gameName,
      prices: priceResult?.prices || [],
      game: gameResult?.game || null,
      ownership: ownershipStatus,
      isDemo: priceResult?.demo || false,
    });
  }

  // --- Fetch real game data from BGG XML API ---
  async function fetchGameDataDirect(gameId) {
    const apiUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${encodeURIComponent(gameId)}&stats=1`;

    // Try direct fetch first (credentials: omit to avoid BGG session cookie 401s)
    try {
      let resp = await fetch(apiUrl, { credentials: 'omit' });

      // BGG returns 202 while processing — retry once after a short delay
      if (resp.status === 202) {
        console.log(LOG_PREFIX, 'BGG API queued (202), retrying in 2s...');
        await new Promise((r) => setTimeout(r, 2000));
        resp = await fetch(apiUrl, { credentials: 'omit' });
      }

      if (!resp.ok) throw new Error(`BGG API returned ${resp.status}`);

      const xml = await resp.text();
      if (!xml || xml.length < 50) throw new Error('Empty XML response');

      const game = parseBggXml(xml, gameId);
      console.log(LOG_PREFIX, 'Parsed game data:', game);
      return { success: true, game, demo: false };
    } catch (err) {
      console.warn(LOG_PREFIX, 'Direct BGG fetch failed, trying via background:', err.message);
    }

    // Fallback: fetch via background service worker
    try {
      const result = await sendMessage({ action: 'fetchGameData', gameId });
      if (result?.game) {
        console.log(LOG_PREFIX, 'Got game data via background:', result.game.name);
        return result;
      }
    } catch (err) {
      console.error(LOG_PREFIX, 'Background fetch also failed:', err.message);
    }

    return { success: true, game: null, demo: true };
  }

  function parseBggXml(xml, gameId) {
    // Primary name
    const nameMatch = xml.match(/<name\s+type="primary"[^>]*value="([^"]*)"/i);
    const name = nameMatch ? htmlDecode(nameMatch[1]) : 'Unknown';

    // Year published
    const yearMatch = xml.match(/<yearpublished[^>]*value="([^"]*)"/i);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Player count
    const minMatch = xml.match(/<minplayers[^>]*value="([^"]*)"/i);
    const maxMatch = xml.match(/<maxplayers[^>]*value="([^"]*)"/i);
    const minPlayers = minMatch ? parseInt(minMatch[1]) : null;
    const maxPlayers = maxMatch ? parseInt(maxMatch[1]) : null;

    // Play time
    const timeMatch = xml.match(/<playingtime[^>]*value="([^"]*)"/i);
    const playingTime = timeMatch ? parseInt(timeMatch[1]) : null;

    // Rating (inside <statistics><ratings><average>)
    const statsBlock = xml.match(/<statistics[\s\S]*?<\/statistics>/i);
    let rating = null;
    let weight = null;
    if (statsBlock) {
      const ratingMatch = statsBlock[0].match(/<average[^>]*value="([^"]*)"/i);
      rating = ratingMatch ? parseFloat(parseFloat(ratingMatch[1]).toFixed(1)) : null;

      const weightMatch = statsBlock[0].match(/<averageweight[^>]*value="([^"]*)"/i);
      weight = weightMatch ? parseFloat(parseFloat(weightMatch[1]).toFixed(1)) : null;
    }

    // Image
    const imageMatch = xml.match(/<image>([^<]+)<\/image>/i);
    const image = imageMatch ? imageMatch[1].trim() : null;

    return {
      id: gameId,
      name,
      rating: rating || 0,
      weight: weight || 0,
      year: year || 0,
      minPlayers: minPlayers || 0,
      maxPlayers: maxPlayers || 0,
      playingTime: playingTime || 0,
      image,
    };
  }

  function htmlDecode(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  }

  // --- MutationObserver: watch for BGG to finish rendering ---
  function observePageChanges() {
    let attempts = 0;
    const maxAttempts = 50; // ~10 seconds

    const observer = new MutationObserver(() => {
      attempts++;
      if (!panelInjected && attempts <= maxAttempts) {
        attemptInjection();
      }
      if (panelInjected || attempts > maxAttempts) {
        observer.disconnect();
        if (!panelInjected) {
          console.warn(LOG_PREFIX, 'Could not inject via observer after', maxAttempts, 'attempts');
          // Last resort: try with just the title
          forceInjectWithTitle();
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also retry on a timer as backup
    let retryCount = 0;
    const retryInterval = setInterval(() => {
      retryCount++;
      if (!panelInjected) {
        attemptInjection();
      }
      if (panelInjected || retryCount > 20) {
        clearInterval(retryInterval);
        if (!panelInjected) {
          forceInjectWithTitle();
        }
      }
    }, 500);
  }

  // --- Force inject using page title as a last resort ---
  function forceInjectWithTitle() {
    if (panelInjected) return;

    const titleName = getGameNameFromTitle();
    if (titleName) {
      console.log(LOG_PREFIX, 'Force injecting with title fallback:', titleName);
      panelInjected = true;
      const container = createPanelContainer();
      renderLoadingState(container);
      fetchAndRender(container, currentGameId, titleName);
    } else {
      console.error(LOG_PREFIX, 'Could not determine game name from any source');
    }
  }

  // --- SPA navigation detection ---
  function watchForSpaNavigation() {
    let lastUrl = window.location.href;

    const check = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        const parsed = parseBggUrl();
        if (parsed && parsed.gameId !== currentGameId) {
          console.log(LOG_PREFIX, 'SPA navigation detected, new game:', parsed.gameId);
          currentGameId = parsed.gameId;
          panelInjected = false;

          // Remove old panel
          const old = document.getElementById('bgg-enhancer-panel');
          if (old) old.remove();

          // Wait for new content to render, then inject
          setTimeout(() => {
            attemptInjection();
            if (!panelInjected) observePageChanges();
          }, 500);
        }
      }
    };

    // Listen for pushState/popState (SPA navigation)
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      setTimeout(check, 100);
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      setTimeout(check, 100);
    };

    window.addEventListener('popstate', () => setTimeout(check, 100));

    // Periodic check as final backup
    setInterval(check, 2000);
  }

  // --- Helpers ---
  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(LOG_PREFIX, chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  function renderLoadingState(container) {
    container.innerHTML = `
      <div class="bgge-card bgge-loading">
        <div class="bgge-header">
          <span class="bgge-logo">BGG Enhancer</span>
        </div>
        <div class="bgge-skeleton-row"></div>
        <div class="bgge-skeleton-row"></div>
        <div class="bgge-skeleton-row"></div>
        <div class="bgge-skeleton-row short"></div>
      </div>
    `;
  }

  function getOwnershipStatus(gameId, collectionResult) {
    if (!collectionResult?.collection) return null;
    const col = collectionResult.collection;
    if (col[gameId]) return col[gameId];
    return null;
  }
})();
