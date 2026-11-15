// Server-only content for Quick Draw. Never import this from the client.

/**
 * Fake-out cues: shown in yellow for a moment during the wait to bait early taps.
 * Kept to 6 characters or fewer so they fit the arena at the same size as the real "DRAW!".
 */
export const FAKE_WORDS = [
  "DRAW?",
  "DRAMA!",
  "DRAWER",
  "DRAWL!",
  "DRAFT!",
  "DRAT!",
  "DRAG!",
  "DREW!",
  "DRAKE!",
  "DRAPE!",
  "DRAWN?",
  "DRAWS?",
] as const;
