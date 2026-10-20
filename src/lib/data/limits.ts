/**
 * Text length limits, shared by the action schemas (zod) and the database
 * CHECK constraints in supabase/migrations/003_length_limits.sql. Change both
 * together; tests/limits.test.ts checks the migration uses these numbers.
 */
export const LIMITS = {
  bio: 280,
  deckName: 80,
  deckNotes: 2000,
  commentBody: 1000,
  scryfallId: 64,
  cardName: 200,
  typeLine: 200,
  manaCost: 100,
  oracleText: 4000,
  imageUri: 512,
  colors: 5,
} as const;

/** The five Magic colors; deck_cards.colors may only contain these. */
export const CARD_COLORS = ["W", "U", "B", "R", "G"] as const;
