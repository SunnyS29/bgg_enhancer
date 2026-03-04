// BGG Enhancer — Price Panel UI

function renderPanel(container, data) {
  const { gameName, prices, game } = data;

  const regions = {};
  for (const p of prices) {
    const r = p.region || 'US';
    if (!regions[r]) regions[r] = [];
    regions[r].push(p);
  }

  const regionLabels = { US: '🇺🇸 US Stores', AU: '🇦🇺 Australian Stores' };
  const currencySymbols = { US: 'US$', AU: 'A$' };

  let priceSections = '';
  for (const [region, stores] of Object.entries(regions)) {
    const sorted = [...stores].sort((a, b) => a.price - b.price);
    const lowest = sorted[0]?.price;
    const symbol = currencySymbols[region] || '$';

    const rows = sorted
      .map((p) => {
        const isLowest = p.price === lowest;
        return `
        <div class="bgge-price-row ${isLowest ? 'bgge-lowest' : ''}">
          <div class="bgge-store-info">
            <span class="bgge-store-name">${escapeHtml(p.store)}</span>
            ${p.inStock ? '<span class="bgge-in-stock">In Stock</span>' : '<span class="bgge-out-stock">Out of Stock</span>'}
          </div>
          <div class="bgge-price-action">
            <span class="bgge-price ${isLowest ? 'bgge-price-best' : ''}">${symbol}${Number(p.price).toFixed(2)}</span>
            <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" class="bgge-buy-btn">
              ${isLowest ? 'Buy ★' : 'Buy'}
            </a>
          </div>
        </div>`;
      })
      .join('');

    priceSections += `
      <div class="bgge-region-group">
        <div class="bgge-region-header" data-region="${region}">
          <span>${regionLabels[region] || region}</span>
          <span class="bgge-region-toggle">▾</span>
        </div>
        <div class="bgge-region-prices" id="bgge-region-${region}">
          ${rows}
        </div>
      </div>`;
  }

  const gameStats = game
    ? `<div class="bgge-stats">
        <div class="bgge-stat" title="BGG Rating"><span class="bgge-stat-icon">★</span><span class="bgge-stat-value">${game.rating}</span></div>
        <div class="bgge-stat" title="Complexity"><span class="bgge-stat-icon">⚖</span><span class="bgge-stat-value">${game.weight}/5</span></div>
        <div class="bgge-stat" title="Players"><span class="bgge-stat-icon">👥</span><span class="bgge-stat-value">${game.minPlayers}–${game.maxPlayers}</span></div>
        <div class="bgge-stat" title="Play Time"><span class="bgge-stat-icon">⏱</span><span class="bgge-stat-value">${game.playingTime}m</span></div>
      </div>`
    : '';

  const noPricesMsg =
    prices.length === 0
      ? '<div class="bgge-no-prices">No prices found — add your RapidAPI key in extension settings for Amazon prices</div>'
      : '';

  container.innerHTML = `
    <div class="bgge-card">
      <div class="bgge-header">
        <span class="bgge-logo">BGG Enhancer</span>
        <button class="bgge-collapse-btn" id="bgge-collapse-toggle" title="Collapse">−</button>
      </div>
      <div class="bgge-body" id="bgge-body">
        ${noPricesMsg}
        ${gameStats}
        <div class="bgge-section-title">Prices for ${escapeHtml(gameName)}</div>
        ${priceSections || '<div class="bgge-no-prices">No prices found</div>'}
      </div>
    </div>
  `;

  // Collapse toggle
  const collapseBtn = container.querySelector('#bgge-collapse-toggle');
  const body = container.querySelector('#bgge-body');
  if (collapseBtn && body) {
    collapseBtn.addEventListener('click', () => {
      body.classList.toggle('bgge-collapsed');
      collapseBtn.textContent = body.classList.contains('bgge-collapsed') ? '+' : '−';
    });
  }

  // Region toggle
  container.querySelectorAll('.bgge-region-header').forEach((header) => {
    header.addEventListener('click', () => {
      const region = header.getAttribute('data-region');
      const pricesEl = container.querySelector(`#bgge-region-${region}`);
      const toggle = header.querySelector('.bgge-region-toggle');
      if (pricesEl) {
        pricesEl.classList.toggle('bgge-region-collapsed');
        toggle.textContent = pricesEl.classList.contains('bgge-region-collapsed') ? '▸' : '▾';
      }
    });
  });

  // Draggable header
  setupDrag(container);
}

function setupDrag(container) {
  const header = container.querySelector('.bgge-header');
  if (!header || !container.classList.contains('bgge-floating')) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    const rect = container.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    container.style.right = 'auto';
    container.style.left = startLeft + 'px';
    container.style.top = startTop + 'px';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    container.style.left = startLeft + (e.clientX - startX) + 'px';
    container.style.top = startTop + (e.clientY - startY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
