"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { cardFromScryfall } from "@/lib/card-from-scryfall";
import type { CollectionFinish } from "@/lib/collection";
import { offeredFinishes, sameCardOracle } from "@/lib/printing";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import {
  listCardPrintings,
  getScryfallCard,
  ScryfallLookupError,
  type CardPrinting,
} from "@/lib/scryfall/client";
import { check, collectionFinishSchema, idSchema } from "@/lib/actions/schemas";
import type { StoredPrinting } from "@/lib/data/types";

export type PrintingsResult = {
  error?: string;
  retryAfterSec?: number;
  currentId?: string;
  printings?: CardPrinting[];
};

export type SwapResult = { error?: string; success?: boolean; retryAfterSec?: number };

function lookupMessage(err: unknown): string {
  if (err instanceof ScryfallLookupError && err.kind === "timeout") {
    return "Scryfall took too long to answer. Try again in a moment.";
  }
  if (err instanceof ScryfallLookupError && err.kind === "too-large") {
    return "Scryfall sent an unexpected answer. Try again in a moment.";
  }
  return "Could not reach Scryfall";
}

async function printingsFor(scryfallId: string): Promise<PrintingsResult> {
  let current;
  try {
    current = await getScryfallCard(scryfallId);
  } catch (err) {
    return { error: lookupMessage(err) };
  }
  if (!current?.oracle_id) return { error: "This card has no other printings we can look up." };
  try {
    const printings = await listCardPrintings(current.oracle_id);
    if (printings.length === 0) return { error: "Scryfall didn't list any printings for this card." };
    return { currentId: current.id, printings };
  } catch (err) {
    return { error: lookupMessage(err) };
  }
}

async function allowLookup(userId: string): Promise<SwapResult | null> {
  const allowed = await limit("card-lookup", { ip: await requestIp(), userId });
  if (!allowed.ok) return limitError(allowed);
  return null;
}

export async function listDeckPrintingsAction(deckId: string, cardId: string): Promise<PrintingsResult> {
  const user = await requireUser();
  const deck = check(idSchema, deckId, "Deck not found");
  if (!deck.ok) return { error: deck.error };
  const card = check(idSchema, cardId, "Card not found in deck");
  if (!card.ok) return { error: card.error };
  const repo = getRepository();
  const permissions = await repo.getDeckPermissions(user.id, deckId);
  if (!permissions.canEdit) return { error: "You cannot edit this deck" };
  const blocked = await allowLookup(user.id);
  if (blocked) return blocked;
  const loaded = await repo.getDeck(user.id, deckId);
  const row = loaded?.cards?.find((item) => item.id === cardId);
  if (!row) return { error: "Card not found in deck" };
  return printingsFor(row.scryfallId);
}

export async function listCollectionPrintingsAction(cardId: string): Promise<PrintingsResult> {
  const user = await requireUser();
  const card = check(idSchema, cardId, "Card not found in your collection");
  if (!card.ok) return { error: card.error };
  const blocked = await allowLookup(user.id);
  if (blocked) return blocked;
  const row = (await getRepository().listMyCollection(user.id)).find((item) => item.id === cardId);
  if (!row) return { error: "Card not found in your collection" };
  return printingsFor(row.scryfallId);
}

function toStored(card: NonNullable<ReturnType<typeof cardFromScryfall>>): StoredPrinting {
  return {
    scryfallId: card.scryfallId,
    cardName: card.cardName,
    imageUri: card.imageUri,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    colors: card.colors,
    colorIdentity: card.colorIdentity,
    oracleText: card.oracleText,
  };
}

async function targetPrinting(currentId: string, nextId: string) {
  let current;
  let target;
  try {
    [current, target] = await Promise.all([getScryfallCard(currentId), getScryfallCard(nextId)]);
  } catch (err) {
    return { error: lookupMessage(err) } as const;
  }
  if (!current || !target) return { error: "Card not found" } as const;
  if (!sameCardOracle(current.oracle_id, target.oracle_id)) {
    return { error: "That printing is a different card." } as const;
  }
  const built = cardFromScryfall(target, 1);
  if (!built) return { error: "This printing can't be saved (its Scryfall data is too long)." } as const;
  return { built, finishes: offeredFinishes(target.finishes) } as const;
}

export async function changeDeckPrintingAction(
  deckId: string,
  cardId: string,
  scryfallId: string,
): Promise<SwapResult> {
  const user = await requireUser();
  const deck = check(idSchema, deckId, "Deck not found");
  if (!deck.ok) return { error: deck.error };
  const card = check(idSchema, cardId, "Card not found in deck");
  if (!card.ok) return { error: card.error };
  const next = check(idSchema, scryfallId, "Card not found");
  if (!next.ok) return { error: next.error };
  const repo = getRepository();
  const permissions = await repo.getDeckPermissions(user.id, deckId);
  if (!permissions.canEdit) return { error: "You cannot edit this deck" };
  const blocked = await allowLookup(user.id);
  if (blocked) return blocked;
  const loaded = await repo.getDeck(user.id, deckId);
  const row = loaded?.cards?.find((item) => item.id === cardId);
  if (!row) return { error: "Card not found in deck" };
  const resolved = await targetPrinting(row.scryfallId, scryfallId);
  if ("error" in resolved) return { error: resolved.error };
  try {
    await repo.changeDeckPrinting(user.id, deckId, cardId, toStored(resolved.built));
  } catch (err) {
    return { error: userMessage(err, "Could not change printing") };
  }
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/my-cards");
  return { success: true };
}

export async function changeCollectionPrintingAction(
  cardId: string,
  scryfallId: string,
  finish: CollectionFinish,
): Promise<SwapResult> {
  const user = await requireUser();
  const card = check(idSchema, cardId, "Card not found in your collection");
  if (!card.ok) return { error: card.error };
  const next = check(idSchema, scryfallId, "Card not found");
  if (!next.ok) return { error: next.error };
  const parsedFinish = collectionFinishSchema.safeParse(finish);
  if (!parsedFinish.success) return { error: "That printing doesn't come in that finish." };
  const blocked = await allowLookup(user.id);
  if (blocked) return blocked;
  const row = (await getRepository().listMyCollection(user.id)).find((item) => item.id === cardId);
  if (!row) return { error: "Card not found in your collection" };
  const resolved = await targetPrinting(row.scryfallId, scryfallId);
  if ("error" in resolved) return { error: resolved.error };
  if (!resolved.finishes.includes(parsedFinish.data)) {
    return { error: "That printing doesn't come in that finish." };
  }
  try {
    await getRepository().changeCollectionPrinting(user.id, cardId, toStored(resolved.built), parsedFinish.data);
  } catch (err) {
    return { error: userMessage(err, "Could not change printing") };
  }
  revalidatePath("/my-cards");
  return { success: true };
}
