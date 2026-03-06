# Portfolio Notes (Non-Sensitive)

This file is for people reviewing my work.
It explains what I built and why I made certain engineering choices, without exposing sensitive implementation details.

## What I Built

- A Chrome Extension (Manifest V3) that injects a floating AU price panel on BoardGameGeek game pages.
- A background service worker that fetches and normalizes store results in parallel.
- A UI layer that renders prices, game stats, and direct external links.
- Matching and filtering logic to reduce wrong game variants (for example base game vs expansion, volume mismatches, and short-name ambiguities).
- Cache versioning so stale data is cleared when matching behavior changes.

## Technical Decisions

- Kept responsibilities separated:
  - `content.js` handles page detection and message passing.
  - `background.js` handles store/network logic and match filtering.
  - `panel.js` handles rendering and panel interactions.
- Added fail-safe behavior:
  - If one store fails, other stores still render.
  - If the BGG stats API is unavailable, pricing still works.
- Used lightweight caching (`chrome.storage.local`) to reduce repeated requests and improve responsiveness.
- Added conservative guards for short game names to avoid false positives like similarly named products.

## Non-Sensitive Snippets

These examples are intentionally small and generic.

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
  - `Mysterium` -> `Mysterium Park`
  - `Catan` -> `Struggle for Catan` / `Catan Junior`
  - `Unmatched: Battle of Legends, Volume One` -> Volume 2 or 3
- Improved long-title reliability when store APIs return empty results for exact subtitle queries.

## Ownership

Designed and implemented by Sunny Sangar.
