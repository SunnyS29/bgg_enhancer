// BGG Enhancer — Price Panel UI Builder

function renderPanel(container, data) {
  const { gameId, gameName, prices, game, ownership, isDemo } = data;

  // Group prices by region, sort each group by price
  const regions = groupByRegion(prices);

  const ownershipBadge = ownership
    ? `<span class="bgge-badge bgge-badge-${ownership.status}">${ownership.label}</span>`
    : '';

  // Build price sections per region
  let priceSections = '';
  const regionLabels = { US: '🇺🇸 US Stores', AU: '🇦🇺 Australian Stores' };
  const currencySymbols = { US: 'US$', AU: 'A$' };

  for (const [region, stores] of Object.entries(regions)) {
    const sorted = [...stores].sort((a, b) => (a.price || 999) - (b.price || 999));
    const lowestInRegion = sorted.find((s) => s.price != null)?.price || null;

    // Show real-priced results first, then search links
    const withPrice = sorted.filter((s) => s.price != null);
    const searchOnly = sorted.filter((s) => s.price == null);
    const ordered = [...withPrice, ...searchOnly];

    const rows = ordered.map((p) => {
      const isLowest = p.price != null && p.price === lowestInRegion;
      const symbol = currencySymbols[region] || '$';
      const isSearch = p.price == null;

      return `
        <div class="bgge-price-row ${isLowest ? 'bgge-lowest' : ''} ${isSearch ? 'bgge-search-row' : ''}">
          <div class="bgge-store-info">
            <span class="bgge-store-name">${escapeHtml(p.store)}</span>
            ${!isSearch ? (p.inStock ? '<span class="bgge-in-stock">In Stock</span>' : '<span class="bgge-out-stock">Out of Stock</span>') : ''}
          </div>
          <div class="bgge-price-action">
            ${!isSearch ? `<span class="bgge-price ${isLowest ? 'bgge-price-best' : ''}">${symbol}${Number(p.price).toFixed(2)}</span>` : ''}
            <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" class="bgge-buy-btn ${isSearch ? 'bgge-search-btn' : ''}">
              ${isSearch ? 'Search' : (isLowest ? 'Buy ★' : 'Buy')}
            </a>
          </div>
        </div>
      `;
    }).join('');

    priceSections += `
      <div class="bgge-region-group">
        <div class="bgge-region-header" data-region="${region}">
          <span>${regionLabels[region] || region}</span>
          <span class="bgge-region-toggle">▾</span>
        </div>
        <div class="bgge-region-prices" id="bgge-region-${region}">
          ${rows}
        </div>
      </div>
    `;
  }

  const gameStats = game
    ? `
      <div class="bgge-stats">
        <div class="bgge-stat" title="BGG Rating">
          <span class="bgge-stat-icon">★</span>
          <span class="bgge-stat-value">${game.rating}</span>
        </div>
        <div class="bgge-stat" title="Complexity Weight">
          <span class="bgge-stat-icon">⚖</span>
          <span class="bgge-stat-value">${game.weight}/5</span>
        </div>
        <div class="bgge-stat" title="Players">
          <span class="bgge-stat-icon">👥</span>
          <span class="bgge-stat-value">${game.minPlayers}–${game.maxPlayers}</span>
        </div>
        <div class="bgge-stat" title="Play Time">
          <span class="bgge-stat-icon">⏱</span>
          <span class="bgge-stat-value">${game.playingTime}m</span>
        </div>
      </div>
    `
    : '';

  const hasRealPrices = prices.some((p) => p.price != null);
  const demoNotice = !hasRealPrices
    ? '<div class="bgge-demo-notice">No prices found — add your RapidAPI key in extension settings for Amazon prices</div>'
    : '';

  container.innerHTML = `
    <div class="bgge-card">
      <div class="bgge-header">
        <span class="bgge-logo">BGG Enhancer</span>
        ${ownershipBadge}
        <button class="bgge-collapse-btn" id="bgge-collapse-toggle" title="Collapse">−</button>
      </div>

      <div class="bgge-body" id="bgge-body">
        ${demoNotice}
        ${gameStats}

        <div class="bgge-section-title">Prices for ${escapeHtml(gameName)}</div>
        ${priceSections || '<div class="bgge-no-prices">No prices found</div>'}

        <div class="bgge-actions">
          <button class="bgge-action-btn bgge-wishlist-btn" data-game-id="${gameId}" title="Add to BGG Wishlist">
            ♥ Wishlist
          </button>
          <button class="bgge-action-btn bgge-collection-btn" data-game-id="${gameId}" title="Mark as Owned on BGG">
            ✓ Owned
          </button>
        </div>

        <div class="bgge-footer">
          <span class="bgge-pro-tease">★ Pro: Price history, drop alerts, deal scores</span>
        </div>
      </div>
    </div>
  `;

  setupPanelEvents(container, gameId);
}

function groupByRegion(prices) {
  const regions = {};
  for (const p of prices) {
    const region = p.region || 'US';
    if (!regions[region]) regions[region] = [];
    regions[region].push(p);
  }
  return regions;
}

function setupPanelEvents(container, gameId) {
  const collapseBtn = container.querySelector('#bgge-collapse-toggle');
  const body = container.querySelector('#bgge-body');

  if (collapseBtn && body) {
    collapseBtn.addEventListener('click', () => {
      body.classList.toggle('bgge-collapsed');
      collapseBtn.textContent = body.classList.contains('bgge-collapsed') ? '+' : '−';
    });
  }

  const wishlistBtn = container.querySelector('.bgge-wishlist-btn');
  if (wishlistBtn) {
    wishlistBtn.addEventListener('click', () => handleCollectionAction(gameId, 'wishlist', wishlistBtn));
  }

  const collectionBtn = container.querySelector('.bgge-collection-btn');
  if (collectionBtn) {
    collectionBtn.addEventListener('click', () => handleCollectionAction(gameId, 'own', collectionBtn));
  }

  // Region toggle (collapse/expand)
  container.querySelectorAll('.bgge-region-header').forEach((header) => {
    header.addEventListener('click', () => {
      const region = header.getAttribute('data-region');
      const prices = container.querySelector(`#bgge-region-${region}`);
      const toggle = header.querySelector('.bgge-region-toggle');
      if (prices) {
        prices.classList.toggle('bgge-region-collapsed');
        toggle.textContent = prices.classList.contains('bgge-region-collapsed') ? '▸' : '▾';
      }
    });
  });

  // Make the panel draggable by its header
  setupDrag(container);
}

function setupDrag(container) {
  const header = container.querySelector('.bgge-header');
  if (!header || !container.classList.contains('bgge-floating')) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener('mousedown', (e) => {
    // Don't drag if clicking a button
    if (e.target.closest('button')) return;

    isDragging = true;
    const rect = container.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    // Switch from right-positioned to left-positioned for dragging
    container.style.right = 'auto';
    container.style.left = startLeft + 'px';
    container.style.top = startTop + 'px';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    container.style.left = (startLeft + dx) + 'px';
    container.style.top = (startTop + dy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

async function handleCollectionAction(gameId, action, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const statusMap = { wishlist: 'wishlist', own: 'own' };
    const resp = await fetch(`https://boardgamegeek.com/api/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        objectid: gameId,
        objecttype: 'thing',
        status: { [statusMap[action]]: true },
      }),
    });

    if (resp.ok || resp.status === 200 || resp.status === 201) {
      btn.textContent = action === 'wishlist' ? '♥ Added!' : '✓ Added!';
      btn.classList.add('bgge-action-success');
    } else {
      const loginRequired = resp.status === 401 || resp.status === 403;
      btn.textContent = loginRequired ? 'Log in to BGG first' : 'Error — try again';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.classList.remove('bgge-action-success');
      }, 2000);
    }
  } catch (err) {
    console.warn('BGG Enhancer: collection action failed', err);
    btn.textContent = 'Error — try again';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2000);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
