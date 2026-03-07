// Shared helpers for content-side scripts.

function parseBggUrl() {
  const match = window.location.pathname.match(/\/boardgame\/(\d+)/);
  if (!match) return null;
  return { gameId: match[1] };
}
