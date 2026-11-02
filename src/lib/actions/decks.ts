"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { COMMANDER_MESSAGES } from "@/lib/data/errors";
import { commanderFromScryfall } from "@/lib/commander";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import { getScryfallCard, ScryfallLookupError } from "@/lib/scryfall/client";
import {
  cardInputSchema,
  check,
  deckSchema,
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
};

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
  });
}

export async function createDeckAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseDeckForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid deck" };
  }

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
    await getRepository().updateDeck(user.id, deckId, {
      ...parsed.data,
      notes: parsed.data.notes ?? "",
    });
  } catch (err) {
    return { error: userMessage(err, "Update failed") };
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

export async function addCardToDeckAction(
  deckId: string,
  input: z.input<typeof cardInputSchema>,
): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "Deck not found");
  if (!id.ok) return { error: id.error };
  const parsed = cardInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card" };
  }

  try {
    await getRepository().addCard(user.id, deckId, {
      scryfallId: parsed.data.scryfallId,
      cardName: parsed.data.cardName,
      imageUri: parsed.data.imageUri ?? null,
      manaCost: parsed.data.manaCost ?? null,
      typeLine: parsed.data.typeLine,
      colors: parsed.data.colors ?? [],
      oracleText: parsed.data.oracleText ?? null,
      quantity: parsed.data.quantity ?? 1,
    });
  } catch (err) {
    return { error: userMessage(err, "Could not add card") };
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
    await getRepository().setCardQuantity(user.id, deckId, cardId, qty.data);
  } catch (err) {
    return { error: userMessage(err, "Could not update card") };
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
    await getRepository().setCommander(user.id, deckId, commander);
  } catch (err) {
    return { error: userMessage(err, "Could not update the commander") };
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return { success: true };
}

export async function forkDeckAction(deckId: string): Promise<ActionResult> {
  const user = await requireUser();
  const id = check(idSchema, deckId, "You are not allowed to fork this deck");
  if (!id.ok) return { error: id.error };
  let newId: string;

  try {
    newId = await getRepository().forkDeck(user.id, deckId);
  } catch (err) {
    return { error: userMessage(err, "Fork failed") };
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
