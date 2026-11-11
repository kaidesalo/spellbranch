"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { cardFromScryfall } from "@/lib/card-from-scryfall";
import { cardLookupKey } from "@/lib/decklist/names";
import { parseDecklist, pastedListProblem } from "@/lib/decklist/parse";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import {
  SCRYFALL_NAME_LOOKUP_MAX,
  ScryfallLookupError,
  getScryfallCard,
  getScryfallCardsByName,
} from "@/lib/scryfall/client";
import {
  addCollectionSchema,
  check,
  collectionListSchema,
  collectionVisibilitySchema,
  idSchema,
  updateCollectionSchema,
} from "@/lib/actions/schemas";

export type CollectionActionResult = {
  error?: string;
  success?: boolean;
  retryAfterSec?: number;
  added?: number;
  missing?: string[];
};

function failure(err: unknown, fallback: string): CollectionActionResult {
  return { error: userMessage(err, fallback) };
}

function lookupMessage(err: unknown): string {
  if (err instanceof ScryfallLookupError && err.kind === "timeout") {
    return "Scryfall took too long to answer. Try again in a moment.";
  }
  if (err instanceof ScryfallLookupError && err.kind === "too-large") {
    return "Scryfall sent an unexpected answer. Try again in a moment.";
  }
  return "Could not reach Scryfall";
}

function refresh() {
  revalidatePath("/my-cards");
}

export async function addCollectionCardAction(input: unknown): Promise<CollectionActionResult> {
  const user = await requireUser();
  const parsed = addCollectionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid card" };

  const allowed = await limit("card-lookup", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return limitError(allowed);

  let found;
  try {
    found = await getScryfallCard(parsed.data.scryfallId);
  } catch (err) {
    return { error: lookupMessage(err) };
  }
  if (!found) return { error: "Card not found" };
  const card = cardFromScryfall(found, parsed.data.quantity);
  if (!card) return { error: "This card can't be added (its Scryfall data is too long)." };

  try {
    await getRepository().addCollectionCard(user.id, {
      scryfallId: card.scryfallId,
      cardName: card.cardName,
      imageUri: card.imageUri,
      manaCost: card.manaCost,
      typeLine: card.typeLine,
      quantity: card.quantity,
      finish: parsed.data.finish,
      condition: parsed.data.condition,
      forTrade: parsed.data.forTrade,
    });
  } catch (err) {
    return failure(err, "Could not add card");
  }
  refresh();
  return { success: true };
}

export async function updateCollectionCardAction(
  cardId: string,
  input: unknown,
): Promise<CollectionActionResult> {
  const user = await requireUser();
  const id = check(idSchema, cardId, "Card not found in your collection");
  if (!id.ok) return { error: id.error };
  const parsed = updateCollectionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid card" };
  try {
    await getRepository().updateCollectionCard(user.id, cardId, parsed.data);
  } catch (err) {
    return failure(err, "Could not update card");
  }
  refresh();
  return { success: true };
}

export async function removeCollectionCardAction(cardId: string): Promise<CollectionActionResult> {
  const user = await requireUser();
  const id = check(idSchema, cardId, "Card not found in your collection");
  if (!id.ok) return { error: id.error };
  try {
    await getRepository().removeCollectionCard(user.id, cardId);
  } catch (err) {
    return failure(err, "Could not remove card");
  }
  refresh();
  return { success: true };
}

export async function setCollectionVisibilityAction(visibility: unknown): Promise<CollectionActionResult> {
  const user = await requireUser();
  const parsed = collectionVisibilitySchema.safeParse(visibility);
  if (!parsed.success) return { error: "Pick private, friends, or public" };
  try {
    await getRepository().setCollectionVisibility(user.id, parsed.data);
  } catch (err) {
    return failure(err, "Could not update who can see your collection");
  }
  refresh();
  return { success: true };
}

export async function importCollectionListAction(list: string): Promise<CollectionActionResult> {
  const user = await requireUser();
  const parsedList = collectionListSchema.safeParse(list);
  if (!parsedList.success) return { error: parsedList.error.issues[0]?.message ?? "Paste a card list." };
  const urlProblem = pastedListProblem(parsedList.data);
  if (urlProblem) return { error: urlProblem };
  const parsed = parseDecklist(parsedList.data);
  const named = [...parsed.cards, ...parsed.commanders];
  if (named.length === 0) return { error: parsed.warnings[0] ?? "No cards found in that list." };
  const quantities = new Map<string, { name: string; quantity: number }>();
  for (const card of named) {
    const key = cardLookupKey(card.name);
    const existing = quantities.get(key);
    if (existing) existing.quantity += card.quantity;
    else quantities.set(key, { name: card.name, quantity: card.quantity });
  }
  if (quantities.size > SCRYFALL_NAME_LOOKUP_MAX) {
    return { error: `That list has more than ${SCRYFALL_NAME_LOOKUP_MAX} different cards.` };
  }
  const allowed = await limit("deck-import", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return limitError(allowed);

  let found;
  try {
    found = await getScryfallCardsByName([...quantities.values()].map((card) => card.name));
  } catch (err) {
    return { error: lookupMessage(err) };
  }
  const byKey = new Map(found.map((card) => [cardLookupKey(card.name), card]));
  const repo = getRepository();
  let added = 0;
  const missing: string[] = [];
  for (const [key, entry] of quantities) {
    const card = byKey.get(key);
    if (!card) {
      missing.push(entry.name);
      continue;
    }
    const built = cardFromScryfall(card, Math.min(9999, entry.quantity));
    if (!built) {
      missing.push(entry.name);
      continue;
    }
    try {
      await repo.addCollectionCard(user.id, {
        scryfallId: built.scryfallId,
        cardName: built.cardName,
        imageUri: built.imageUri,
        manaCost: built.manaCost,
        typeLine: built.typeLine,
        quantity: built.quantity,
        finish: "nonfoil",
        condition: null,
        forTrade: false,
      });
      added += 1;
    } catch (err) {
      return failure(err, "Could not add those cards");
    }
  }
  refresh();
  if (added === 0) {
    return { error: missing.length ? `Couldn't find ${missing.slice(0, 5).join(", ")}.` : "No cards were added." };
  }
  return { success: true, added, missing: missing.slice(0, 8) };
}
