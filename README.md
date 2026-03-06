# BGG Price Compare AU

`BGG Price Compare AU` is a Chrome extension that adds a small price panel to BoardGameGeek game pages.

It helps you quickly check Australian store prices for the game you are viewing.

## What It Does

- Shows a floating panel on BGG game pages
- Compares prices from several AU stores
- Highlights the cheapest result
- Gives direct links to each store listing

No API key is needed.

## Stores Included

- Gameology
- GUF
- Board Game Master
- Games Empire
- Good Games
- eBay AU

## Install (Chrome)

1. Download or clone this repo.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked**.
5. Select the `bgg-enhancer` folder.
6. Open any BGG game page like `https://boardgamegeek.com/boardgame/...`.

## How To Use

1. Open a game page on BoardGameGeek.
2. Wait a moment for the price panel to appear on the right.
3. Click any `Buy` button to open that store page.

That is it.

## Notes

- Long or very specific game names are handled with fallback search queries.
- Prices are cached for a short time to reduce repeated requests.
- If no prices are found, it usually means stores returned no close match for that game at that moment.

## Troubleshooting

### "No Australian prices found"

- Refresh the page and wait a few seconds.
- Try another game to confirm the extension is running.
- Some games have inconsistent store naming and may not return matches.

### `BGG API 401` warning in console

- This comes from BoardGameGeek's external XML API.
- Price matching still works even if game stats fail to load.
- This is not caused by your extension setup.

## License

MIT
