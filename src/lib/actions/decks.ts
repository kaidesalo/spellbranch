"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { COMMANDER_MESSAGES, DeckColorError } from "@/lib/data/errors";
import { cardFromScryfall } from "@/lib/card-from-scryfall";
import { commanderFromScryfall } from "@/lib/commander";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import { getScryfallCard, ScryfallLookupError } from "@/lib/scryfall/client";
import {
  addCardSchema,
  check,
  deckSchema,
  forkNameSchema,
  idSchema,
  isFormData,
  quantitySchema,
} from "@/lib/actions/schemas";

export type ActionResult = {
  error?: string;
  success?: boolean;
  id?: string;
  /** Rate-limited actions: seconds until the caller may retry. */
  retryAfterSec?: number;
  /** updateCardQuantityAction: the quantity that was saved (0 = removed). */
  quantity?: number;
  /**
   * A deck-colors refusal: the deck's cards that don't fit the colors asked
   * for, so the form can list them (nothing is ever removed to make room).
   */
  offColorCards?: string[];
};

/** { error } for a failed write, with the off-color cards when there are any. */
function failure(err: unknown, fallback: string): ActionResult {
  const result: ActionResult = { error: userMessage(err, fallback) };
  if (err instanceof DeckColorError && err.cards.length > 0) result.offColorCards = err.cards;
  return result;
}

function parseDeckForm(formData: unknown) {
  if (!isFormData(formData)) {
    return { success: false as const, error: { issues: [{ message: "Invalid deck" }] } };
  }
  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return deckSchema.safeParse({
    name: text("name"),
    format: text("format"),
    notes: text("notes") ?? "",
    visibility: text("visibility"),
    allowForks: formData.get("allowForks") === "on" || formData.get("allowForks") === "true",
    colors: text("colors"),
  });
}

export async function createDeckAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseDeckForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid deck" };
  }
  // New decks must pick colors; only decks from before this feature have none.
  if (!parsed.data.colors) return { error: "Pick the deck's colors" };

  let id: string;
  try {
    id = await getRepository().createDeck(user.id, {
      ...parsed.data,
      notes: parsed.data.notes ?? "",
    });
  } catch (err) {
    return { error: userMessage(err, "Could not create deck") };
  }

  revalidatePath("/decks");
  revalidatePath("/dashboard");
  redirect(`/decks/${id}`);
}

export async function updateDeckMetaAction(
  deckId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "Deck not found");
  if (!id.ok) return { error: id.error };
  const parsed = parseDeckForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid deck" };
  }

  try {
    // No colors in the form leaves them as they are; narrowing them so a
    // card or the commander no longer fits is refused with the list.
    await getRepository().updateDeck(user.id, deckId, {
      ...parsed.data,
      notes: parsed.data.notes ?? "",
    });
  } catch (err) {
    return failure(err, "Update failed");
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return { success: true };
}

export async function deleteDeckAction(deckId: string): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "Deck not found");
  if (!id.ok) return { error: id.error };

  try {
    await getRepository().deleteDeck(user.id, deckId);
  } catch (err) {
    return { error: userMessage(err, "Delete failed") };
  }

  revalidatePath("/decks");
  revalidatePath("/dashboard");
  redirect("/decks");
}

/**
 * Adds a card to a deck. The client sends only the Scryfall id (and a
 * quantity); the card is fetched from Scryfall here and built with
 * cardFromScryfall, so the stored name, text, colors and color identity
 * never come from the client, and the deck-colors rule is checked on
 * Scryfall's own color identity (same pattern as setCommanderAction).
 *
 * Before the lookup the attempt is rate limited (card-lookup) and the deck
 * must be one the caller can edit, so this can't be used to make the server
 * fetch from Scryfall for free. The repository checks ownership and the
 * colors again when it writes (and in Supabase mode, so does the database).
 */
export async function addCardToDeckAction(deckId: string, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "Deck not found");
  if (!id.ok) return { error: id.error };
  const parsed = addCardSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid card" };

  const allowed = await limit("card-lookup", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return limitError(allowed);
  const repo = getRepository();
  try {
    const permissions = await repo.getDeckPermissions(user.id, deckId);
    if (!permissions.canEdit) return { error: "You cannot edit this deck" };
  } catch (err) {
    return { error: userMessage(err, "Could not add card") };
  }
  let found;
  try {
    found = await getScryfallCard(parsed.data.scryfallId);
  } catch (err) {
    return { error: scryfallLookupMessage(err) };
  }
  if (!found) return { error: "Card not found" };
  const card = cardFromScryfall(found, parsed.data.quantity);
  if (!card) return { error: "This card can't be added (its Scryfall data is too long)." };

  try {
    await repo.addCard(user.id, deckId, card);
  } catch (err) {
    return failure(err, "Could not add card");
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true };
}

export async function updateCardQuantityAction(
  deckId: string,
  cardId: string,
  quantity: number,
): Promise<ActionResult> {
  const user = await requireUser();
  const ids = check(idSchema, deckId, "Deck not found");
  if (!ids.ok) return { error: ids.error };
  const card = check(idSchema, cardId, "Card not found in deck");
  if (!card.ok) return { error: card.error };
  // Above the max is capped, not refused (see quantitySchema).
  const qty = check(quantitySchema, quantity, "Quantity must be between 0 and 99");
  if (!qty.ok) return { error: qty.error };

  try {
    // The repository checks that the user owns the deck and the card is in it.
    // Raising an off-color card's quantity is refused; lowering never is.
    await getRepository().setCardQuantity(user.id, deckId, cardId, qty.data);
  } catch (err) {
    return failure(err, "Could not update card");
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true, quantity: qty.data };
}

export async function removeCardFromDeckAction(
  deckId: string,
  cardId: string,
): Promise<ActionResult> {
  return updateCardQuantityAction(deckId, cardId, 0);
}

function scryfallLookupMessage(err: unknown): string {
  if (err instanceof ScryfallLookupError && err.kind === "timeout") {
    return "Scryfall took too long to answer. Try again in a moment.";
  }
  if (err instanceof ScryfallLookupError && err.kind === "too-large") {
    return "Scryfall sent an unexpected answer. Try again in a moment.";
  }
  return "Could not reach Scryfall";
}

/**
 * Sets (or with null, clears) a Commander deck's commander. The client sends
 * only a Scryfall id: the card itself is fetched from Scryfall here, so the
 * name, type line and images that get stored never come from the client, and
 * the legendary-creature rule is checked on Scryfall's own type line. The
 * repository re-checks ownership, the format and the rule (and the database
 * CHECKs them once more in Supabase mode).
 *
 * Cipher PR #9 L1: before any Scryfall lookup, the attempt is rate limited
 * (commander-lookup, per IP and per user) and the deck must be the caller's
 * own Commander deck, so nobody can use this to make the server fetch from
 * Scryfall for free. Clearing makes no lookup and isn't limited.
 */
export async function setCommanderAction(
  deckId: string,
  scryfallId: string | null,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "Deck not found");
  if (!id.ok) return { error: id.error };
  const card = check(idSchema.nullable(), scryfallId, "Card not found");
  if (!card.ok) return { error: card.error };

  let commander = null;
  if (card.data !== null) {
    const allowed = await limit("commander-lookup", { ip: await requestIp(), userId: user.id });
    if (!allowed.ok) return limitError(allowed);
    try {
      await getRepository().assertCanSetCommander(user.id, deckId);
    } catch (err) {
      return { error: userMessage(err, "Could not update the commander") };
    }
    let found;
    try {
      found = await getScryfallCard(card.data);
    } catch (err) {
      return { error: scryfallLookupMessage(err) };
    }
    if (!found) return { error: "Card not found" };
    commander = commanderFromScryfall(found);
    if (!commander) return { error: COMMANDER_MESSAGES.notLegendaryCreature };
  }

  try {
    // Deck colors: the commander must fit them, or (a deck with no colors
    // yet) the deck takes the commander's color identity.
    await getRepository().setCommander(user.id, deckId, commander);
  } catch (err) {
    return failure(err, "Could not update the commander");
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return { success: true };
}

export async function forkDeckAction(deckId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "You are not allowed to fork this deck");
  if (!id.ok) return { error: id.error };
  if (!isFormData(formData)) return { error: "Deck name is required" };
  const name = check(forkNameSchema, formData.get("name"), "Deck name is required");
  if (!name.ok) return { error: name.error };
  let newId: string;

  try {
    newId = await getRepository().forkDeck(user.id, deckId, name.data);
  } catch (err) {
    return { error: userMessage(err, "Fork failed") };
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  redirect(`/decks/${newId}`);
}

export async function copyDeckAction(deckId: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "You are not allowed to copy this deck");
  if (!id.ok) return { error: id.error };
  if (!isFormData(formData)) return { error: "Deck name is required" };
  const name = check(forkNameSchema, formData.get("name"), "Deck name is required");
  if (!name.ok) return { error: name.error };
  let newId: string;

  try {
    newId = await getRepository().copyDeck(user.id, deckId, name.data);
  } catch (err) {
    return { error: userMessage(err, "Copy failed") };
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  redirect(`/decks/${newId}`);
}

export async function setPreferredBranchAction(
  sourceDeckId: string,
  branchId: string | null,
): Promise<ActionResult> {
  const user = await requireUser();
  const source = check(idSchema, sourceDeckId, "Deck not found");
  if (!source.ok) return { error: source.error };
  const branch = check(idSchema.nullable(), branchId, "Branch does not belong to this deck");
  if (!branch.ok) return { error: branch.error };

  try {
    await getRepository().setPreferredBranch(user.id, sourceDeckId, branchId);
  } catch (err) {
    return { error: userMessage(err, "Could not set preferred branch") };
  }

  revalidatePath(`/decks/${sourceDeckId}`);
  revalidatePath(`/decks/${sourceDeckId}/compare`);
  return { success: true };
}
