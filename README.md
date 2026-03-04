# BGG Enhancer

A Chrome extension that shows price comparisons for board games directly on [BoardGameGeek](https://boardgamegeek.com) game pages.

## Features

- **Price Comparisons** — See prices from multiple stores in a floating panel on any BGG game page
- **Game Stats** — Quick view of BGG rating, complexity weight, player count, and play time
- **Region Grouping** — Prices grouped by region (US / AU) with the lowest price highlighted
- **Direct Buy Links** — Links go straight to the product page, not a search results page
- **SPA Navigation** — Works seamlessly as you browse between game pages on BGG

## Supported Stores

| Store | Region | Source |
|-------|--------|--------|
| Amazon | US | RapidAPI (requires free API key) |
| eBay | US | HTML parsing |
| eBay AU | AU | HTML parsing |
| Gameology | AU | Shopify API |
| GUF | AU | Shopify API |
| Board Game Master | AU | Shopify API |
| Games Empire | AU | Shopify API |

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `bgg-enhancer` folder
5. Visit any game page on [BoardGameGeek](https://boardgamegeek.com/boardgame/) to see prices

## Setup

Click the extension icon to open settings:

- **BGG Username** — Optional, for future collection features
- **RapidAPI Key** — Required for Amazon prices. Get a free key:
  1. Go to [rapidapi.com](https://rapidapi.com)
  2. Search for "Real-Time Amazon Data"
  3. Subscribe to the free tier
  4. Copy your API key into the extension settings

Australian store prices (Gameology, GUF, Board Game Master, Games Empire) and eBay prices work without any API key.

## How It Works

- **Content script** detects when you're on a BGG game page and injects a floating price panel
- **Background service worker** fetches prices from all stores in parallel
- **Amazon**: Uses RapidAPI's Real-Time Amazon Data API
- **Shopify stores**: Uses Shopify's `/search/suggest.json` API (structured JSON, no scraping)
- **eBay**: Parses server-rendered HTML search results
- Results are cached for 1 hour to minimize API calls

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- BGG XML API2 for game data
- RapidAPI for Amazon prices
- Shopify Suggest API for AU stores

## License

MIT
