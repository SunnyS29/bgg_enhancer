# BGG Price Compare AU

`BGG Price Compare AU` adds a floating AU price panel to BoardGameGeek game pages.

I built this for one practical reason: when I'm browsing BGG, I want to know what a game costs right now in local stores without opening ten tabs.

## What It Does

- Pulls listing prices from supported AU stores
- Highlights the best-priced match
- Links directly to product pages
- Shows BGG stats when the BGG API responds
- Handles BGG's SPA-style page navigation

No API key required.

## Stores Included

- Gameology
- GUF
- Board Game Master
- Games Empire
- Good Games
- eBay AU

## Install (Chrome)

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select the `bgg-enhancer` folder.
6. Open a BGG game page like `https://boardgamegeek.com/boardgame/...`.

## How To Use

1. Open a game page on BoardGameGeek.
2. Wait a moment for the panel to load.
3. Click `Buy` to jump to a store listing.

Done.

## Notes

- Some store catalogs are messy, especially for long subtitle-heavy titles.
- Matching is intentionally conservative to avoid confidently showing the wrong game.
- If no price appears, the extension likely rejected weak matches instead of guessing.

## Troubleshooting

### "No Australian prices found"

- Refresh and give it a few seconds.
- Try a different game page to confirm the extension is active.
- Some titles simply don't return reliable store matches at that moment.

### `BGG API 401` warning

- This comes from BoardGameGeek's XML API endpoint.
- Price fetching still works when stats fail.
- It is not caused by your local extension setup.

## Portfolio Notes

If you're reviewing this project as a work sample, see [PORTFOLIO_NOTES.md](./docs/PORTFOLIO_NOTES.md) for architecture notes and non-sensitive snippets.

## License

Copyright (c) 2026 Sunny Sangar. All rights reserved.

This project is proprietary.
You may not copy, modify, distribute, sublicense, or sell any part of this software without written permission from the copyright holder.
