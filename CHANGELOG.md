# Changelog

## [2.0.0] - 2026-03-05

### Changed
- **Pivoted to AU-only** — Extension now focuses exclusively on Australian board game stores
- Renamed to "BGG Price Compare AU"
- Removed Amazon US, eBay US — BGG already shows US store prices natively
- Removed RapidAPI dependency — no API key needed, everything works out of the box
- Flat price list in A$ (no more region grouping)
- Simplified popup — just BGG username setting + store list

### Added
- **Good Games** (goodgames.com.au) as 5th Shopify AU store
- Tighter product matching — title similarity ratio check to reject wrong editions/versions
- Store list display in popup so users know which stores are compared

### Stores
- Gameology, GUF, Board Game Master, Games Empire, Good Games (Shopify API)
- eBay AU (HTML parsing)

## [1.1.0] - 2026-03-04

### Changed
- Major simplification — Stripped codebase from ~1200 lines to ~600 lines
- Removed collection/ownership features, pro teaser, demo mode, dead code
- Simplified popup settings — just BGG username and RapidAPI key

### Fixed
- BGG API 401 errors — added `credentials: 'omit'`
- Amazon matching wrong products — word boundary regex + position check
- Shopify stores returning expansions first — prefer shortest matching title

## [1.0.0] - 2026-03-03

### Added
- Initial release
- Price comparisons from Amazon (US), eBay (US/AU), and 4 Australian Shopify stores
- Game stats, floating draggable panel, SPA navigation, 1-hour cache
