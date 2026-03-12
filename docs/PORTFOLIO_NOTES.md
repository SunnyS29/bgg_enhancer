# Portfolio Notes (Non-Sensitive)

This is a short, reviewer-friendly summary of the work.
It covers what I built and the decisions behind it, without exposing sensitive implementation details.

## What I Built

- A Chrome Extension (Manifest V3) that adds a floating AU price panel on BoardGameGeek game pages.
- A background service worker that fetches and normalizes store results in parallel.
- A UI layer that shows prices, game stats, and direct external links.
- Matching and filtering logic to reduce wrong game variants (for example base game vs expansion, volume mismatches, and short-name ambiguities).
- Cache versioning so stale data gets cleared when matching behavior changes.

## Technical Decisions

- I kept responsibilities separated:
  - `src/content.js` handles page detection and message passing.
  - `src/background.js` handles store/network logic and match filtering.
  - `src/panel.js` handles rendering and panel interactions.
- I added fail-safe behavior:
  - If one store fails, other stores still render.
  - If the BGG stats API is unavailable, pricing still works.
- I used lightweight caching (`chrome.storage.local`) to reduce repeated requests and improve responsiveness.
- I added conservative guards for short game names to avoid false positives from similarly named products.

## Non-Sensitive Snippets

Here are a few short examples from common patterns used in this project.

### 1) Cache wrapper pattern

```js
async function getFromCache(key, ttlMs) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const entry = result[key];
      const fresh = entry && Date.now() - entry.ts < ttlMs;
      resolve(fresh ? entry.data : null);
    });
  });
}
```

### 2) SPA navigation detection pattern

```js
function watchForRouteChanges(onChanged) {
  let lastUrl = location.href;
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onChanged(lastUrl);
    }
  };
  const push = history.pushState;
  history.pushState = function (...args) {
    push.apply(this, args);
    setTimeout(check, 100);
  };
  addEventListener('popstate', () => setTimeout(check, 100));
}
```

### 3) Safe query fallback pattern

```js
function buildSearchQueries(gameName) {
  const cleaned = gameName.trim().toLowerCase();
  const words = cleaned.split(/\s+/);
  return [
    cleaned,
    words.slice(0, 3).join(' '),
    words.slice(0, 4).join(' '),
  ].filter(Boolean);
}
```

## Example Outcomes I Worked On

- Reduced false matches such as:
  - `Mysterium` to `Mysterium Park`
  - `Catan` to `Struggle for Catan` / `Catan Junior`
  - `Unmatched: Battle of Legends, Volume One` to Volume 2 or 3
- Improved long-title reliability when store APIs return empty results for exact subtitle queries.

## Ownership

Designed and implemented by Sunny Sangar.
