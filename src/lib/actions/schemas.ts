import { z } from "zod";
import { LIMITS } from "@/lib/data/limits";
import { colorsFromKey } from "@/lib/deck-colors";
import { isUuid } from "@/lib/data/validation";
import { MAX_CARD_QUANTITY, clampQuantity } from "@/lib/deck-quantity";

const QUANTITY_MESSAGE = `Quantity must be between 0 and ${MAX_CARD_QUANTITY}`;

/**
 * Argument schemas for the server actions (Cipher PR #3 review, L2/L4).
 * Server actions are public endpoints: any client can call them with any
 * JSON-ish payload, so every argument is checked here before use and a bad
 * payload becomes a clean { error } instead of a thrown 500.
 *
 * Not a "use server" module: it only exports schemas and helpers.
 */

export const idSchema = z.string("Invalid id").refine(isUuid, "Invalid id");

const nullableText = (max: number) => z.string().max(max).nullable().optional();

export const forkNameSchema = z
  .string("Deck name is required")
  .trim()
  .min(1, "Deck name is required")
  .max(LIMITS.deckName, `Deck name must be at most ${LIMITS.deckName} characters`);

export const deckSchema = z.object({
  name: z.string().trim().min(1, "Deck name is required").max(LIMITS.deckName, `Deck name must be at most ${LIMITS.deckName} characters`),
  format: z.enum(["commander", "standard", "modern", "pioneer", "legacy", "pauper", "casual"]),
  notes: z.string().max(LIMITS.deckNotes, `Notes must be at most ${LIMITS.deckNotes} characters`).optional().default(""),
  visibility: z.enum(["private", "friends", "public"]),
  allowForks: z.boolean(),
  /**
   * The color picker's value: one of the COLOR_COMBOS keys ("UB", "WUBRG",
   * "C" for Colorless), turned into colors. Missing = undefined (the create
   * action then refuses; the update action leaves the colors alone).
   */
  colors: z
    .string()
    .max(8)
    .optional()
    .transform((key, ctx) => {
      if (key === undefined || key === "") return undefined;
      const colors = colorsFromKey(key);
      if (colors) return colors;
      ctx.addIssue({ code: "custom", message: "Pick the deck's colors" });
      return z.NEVER;
    }),
});

/**
 * Adding a card: only the Scryfall id and a quantity. The server fetches the
 * card from Scryfall itself (cardFromScryfall), so anything else the client
 * sends (name, text, colors, identity) is ignored.
 */
export const addCardSchema = z.object({
  scryfallId: idSchema,
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

export const favoriteSchema = z.object({
  scryfallId: z.string().min(1).max(LIMITS.scryfallId),
  cardName: z.string().min(1).max(LIMITS.cardName),
  imageUri: nullableText(LIMITS.imageUri),
  manaCost: nullableText(LIMITS.manaCost),
  typeLine: nullableText(LIMITS.typeLine),
});

/**
 * A deck-list quantity: a whole number from 0 (removes the card) up. Larger
 * numbers are capped at MAX_CARD_QUANTITY instead of refused, so a typed
 * "500" saves as 99; negatives, decimals, NaN and non-numbers are refused.
 */
export const quantitySchema = z
  .number(QUANTITY_MESSAGE)
  .int(QUANTITY_MESSAGE)
  .min(0, QUANTITY_MESSAGE)
  .transform(clampQuantity);

export const commentBodySchema = z
  .string("Comment must be text")
  .trim()
  .min(1, "Comment cannot be empty")
  .max(LIMITS.commentBody, "Comment is too long");

export const usernameQuerySchema = z.string().max(64);

/** First issue's message, or the fallback. */
export function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/** Returns the parsed value, or { error } with a short message. */
export function check<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: string,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: firstIssue(parsed.error, fallback) };
}

export function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}
