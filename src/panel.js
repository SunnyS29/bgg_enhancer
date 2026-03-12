// Price panel UI: render results, keep interactions simple.

function renderPanel(container, data) {
  const { gameName, prices, game } = data;

  const lowest = prices.length > 0 ? prices[0].price : null;

  const priceRows = prices
    .map((p) => {
      const isLowest = p.price === lowest;
      return `
      <div class="bgge-price-row ${isLowest ? 'bgge-lowest' : ''}">
        <div class="bgge-store-info">
          <div class="bgge-store-name">${escapeHtml(p.store)}</div>
          <div class="${p.inStock ? 'bgge-in-stock' : 'bgge-out-stock'}">
            ${p.inStock ? '● IN STOCK' : '○ OUT OF STOCK'}
          </div>
          ${p.onSale ? `<span class="bgge-sale-badge">${escapeHtml(p.saleLabel || 'SALE')}</span>` : ''}
        </div>
        <div class="bgge-price-action">
          ${p.onSale && p.originalPrice ? `<span class="bgge-price-original">A$${Number(p.originalPrice).toFixed(2)}</span>` : ''}
          <span class="bgge-price ${isLowest ? 'bgge-price-best' : ''}">A$${Number(p.price).toFixed(2)}</span>
          <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" class="bgge-buy-btn">
            LINK
          </a>
        </div>
      </div>`;
    })
    .join('');

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
      ? '<div class="bgge-no-prices">No Australian prices found for this game</div>'
      : '';

  container.innerHTML = `
    <div class="bgge-card">
      <div class="bgge-header">
        <span class="bgge-logo">🇦🇺 BGG Price Compare AU</span>
        <button class="bgge-collapse-btn" id="bgge-collapse-toggle" title="Collapse">−</button>
      </div>
      <div class="bgge-body" id="bgge-body">
        ${gameStats}
        <div class="bgge-section-title">AU Prices — ${escapeHtml(gameName)}</div>
        ${noPricesMsg}
        <div class="bgge-price-list">
          ${priceRows}
        </div>
      </div>
    </div>
  `;

  // Quick collapse/expand without removing the panel.
  const collapseBtn = container.querySelector('#bgge-collapse-toggle');
  const body = container.querySelector('#bgge-body');
  if (collapseBtn && body) {
    collapseBtn.addEventListener('click', () => {
      body.classList.toggle('bgge-collapsed');
      collapseBtn.textContent = body.classList.contains('bgge-collapsed') ? '+' : '−';
    });
  }

  // Let the user drag the panel out of the way.
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
