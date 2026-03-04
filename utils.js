// BGG Enhancer — Shared Utilities

function parseBggUrl() {
  const match = window.location.pathname.match(/\/boardgame\/(\d+)/);
  if (!match) return null;
  return { gameId: match[1] };
}
