// Content script: detect BGG game pages and mount the price panel.

(function () {
  'use strict';

  let currentGameId = null;
  let panelInjected = false;

  init();

  function init() {
    const parsed = parseBggUrl();
    if (!parsed) return;

    currentGameId = parsed.gameId;
    console.log('[BGG Enhancer] Game ID:', currentGameId);

    waitForGameName();
    watchForSpaNavigation();
  }

  // BGG can render late, so wait briefly for a reliable game title.
  function waitForGameName() {
    let attempts = 0;
    const maxAttempts = 30;

    const tryInject = () => {
      if (panelInjected) return;
      attempts++;

      const gameName = getGameName();
      if (gameName) {
        inject(gameName);
      } else if (attempts < maxAttempts) {
        setTimeout(tryInject, 300);
      } else {
        console.warn('[BGG Enhancer] Could not find game name after', maxAttempts, 'attempts');
      }
    };

    tryInject();
  }

  function getGameName() {
    // Prefer stable DOM selectors first.
    const selectors = ['h1 a', 'h1', '.game-header-title-info a', 'meta[property="og:title"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = sel.startsWith('meta') ? el.getAttribute('content') : el.textContent;
      const cleaned = text?.trim().replace(/\s+/g, ' ');
      if (cleaned && cleaned.length > 0 && cleaned.length < 200) return cleaned;
    }

    // Fallback to document title if selectors miss.
    const title = document.title?.split(/[|\u2013\u2014–—]/)[0]?.trim();
    if (title && title !== 'BoardGameGeek' && title.length > 0) return title;

    return null;
  }

  function inject(gameName) {
    panelInjected = true;
    console.log('[BGG Enhancer] Injecting for:', gameName);

    const panel = document.createElement('div');
    panel.id = 'bgg-enhancer-panel';
    panel.classList.add('bgge-floating');
    document.body.appendChild(panel);

    // Render a quick skeleton so the panel appears instantly.
    panel.innerHTML = `
      <div class="bgge-card bgge-loading">
        <div class="bgge-header">
          <span class="bgge-logo">BGG Enhancer</span>
        </div>
        <div class="bgge-skeleton-row"></div>
        <div class="bgge-skeleton-row"></div>
        <div class="bgge-skeleton-row short"></div>
      </div>
    `;

    // Fetch prices and stats in parallel, then render once.
    fetchAndRender(panel, currentGameId, gameName);
  }

  async function fetchAndRender(container, gameId, gameName) {
    const [priceResult, gameResult] = await Promise.all([
      sendMessage({ action: 'fetchPrices', gameName, gameId }),
      sendMessage({ action: 'fetchGameData', gameId }),
    ]);

    renderPanel(container, {
      gameId,
      gameName,
      prices: priceResult?.prices || [],
      game: gameResult?.game || null,
    });
  }

  // BGG behaves like an SPA, so watch route changes and rebind.
  function watchForSpaNavigation() {
    let lastUrl = window.location.href;

    const check = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        const parsed = parseBggUrl();
        if (parsed && parsed.gameId !== currentGameId) {
          console.log('[BGG Enhancer] SPA nav to game:', parsed.gameId);
          currentGameId = parsed.gameId;
          panelInjected = false;

          const old = document.getElementById('bgg-enhancer-panel');
          if (old) old.remove();

          setTimeout(() => waitForGameName(), 500);
        }
      }
    };

    const origPush = history.pushState;
    history.pushState = function (...args) {
      origPush.apply(this, args);
      setTimeout(check, 100);
    };

    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      setTimeout(check, 100);
    };

    window.addEventListener('popstate', () => setTimeout(check, 100));
    setInterval(check, 2000);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[BGG Enhancer]', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }
})();
