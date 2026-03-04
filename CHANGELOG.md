# Changelog

## [1.1.0] - 2026-03-04

### Changed
- **Major simplification** — Stripped codebase from ~1200 lines to ~600 lines
- Removed collection/ownership features (wishlist, owned badges, collection fetching)
- Removed pro teaser and unused UI elements
- Removed Cloudflare Worker dependency — all fetching handled by background service worker
- Removed demo mode and fake data generators
- Removed duplicate XML parsing (content.js no longer parses BGG XML — delegates to background.js)
- Simplified page injection retry from 3 systems to 1 simple timer
- Cleaned up dead code in utils.js (removed unused cache helpers, formatPrice)
- Cleaned up unused CSS classes (badges, action buttons, search rows, pro teaser)
- Simplified popup settings — just BGG username and RapidAPI key

### Fixed
- BGG API 401 errors — added `credentials: 'omit'` to avoid session cookie conflicts
- Amazon matching wrong products (e.g. Wyrmspan matching "Wingspan") — word boundary regex + position check
- Shopify stores returning expansions first — prefer shortest matching title
- Cache now only stores results with real prices (no more caching empty results)

## [1.0.0] - 2026-03-03

### Added
- Initial release
- Price comparisons from Amazon (US), eBay (US/AU), and 4 Australian Shopify stores
- Game stats display (rating, weight, players, play time) from BGG XML API
- Floating draggable price panel on BGG game pages
- Region-grouped prices with lowest price highlighting
- SPA navigation support for seamless browsing
- 1-hour price cache to minimize API calls
- Extension popup for settings (BGG username, RapidAPI key)
