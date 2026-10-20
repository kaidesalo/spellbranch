"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { updateStore } from "@/lib/data/store";
import { canEditDeck, canForkDeck } from "@/lib/permissions";
import type { Deck, DeckCard, DeckFormat, Visibility } from "@/lib/types";

export type ActionResult = { error?: string; success?: boolean; id?: string };

const deckSchema = z.object({
  name: z.string().min(1, "Deck name is required").max(80),
  format: z.enum([
    "commander",
    "standard",
    "modern",
    "pioneer",
    "legacy",
    "pauper",
    "casual",
  ]),
  notes: z.string().max(2000).optional().default(""),
  visibility: z.enum(["private", "friends", "public"]),
  allowForks: z.boolean(),
});

export async function createDeckAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = deckSchema.safeParse({
    name: formData.get("name"),
    format: formData.get("format"),
    notes: formData.get("notes") ?? "",
    visibility: formData.get("visibility"),
    allowForks: formData.get("allowForks") === "on" || formData.get("allowForks") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid deck" };
  }

  const now = new Date().toISOString();
  const id = uuidv4();

  await updateStore((store) => {
    store.decks.push({
      id,
      ownerId: user.id,
      name: parsed.data.name,
      format: parsed.data.format as DeckFormat,
      notes: parsed.data.notes ?? "",
      visibility: parsed.data.visibility as Visibility,
      allowForks: parsed.data.allowForks,
      forkedFromId: null,
      preferredBranchId: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  revalidatePath("/decks");
  revalidatePath("/dashboard");
  redirect(`/decks/${id}`);
}

export async function updateDeckMetaAction(
  deckId: string,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = deckSchema.safeParse({
    name: formData.get("name"),
    format: formData.get("format"),
    notes: formData.get("notes") ?? "",
    visibility: formData.get("visibility"),
    allowForks: formData.get("allowForks") === "on" || formData.get("allowForks") === "true",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid deck" };
  }

  try {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canEditDeck(deck, user.id)) {
        throw new Error("You cannot edit this deck");
      }
      deck.name = parsed.data.name;
      deck.format = parsed.data.format;
      deck.notes = parsed.data.notes ?? "";
      deck.visibility = parsed.data.visibility;
      deck.allowForks = parsed.data.allowForks;
      deck.updatedAt = new Date().toISOString();
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Update failed" };
  }

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  return { success: true };
}

export async function deleteDeckAction(deckId: string): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canEditDeck(deck, user.id)) {
        throw new Error("You cannot delete this deck");
      }
      store.decks = store.decks.filter((d) => d.id !== deckId);
      store.deckCards = store.deckCards.filter((c) => c.deckId !== deckId);
      store.comments = store.comments.filter((c) => c.deckId !== deckId);
      for (const d of store.decks) {
        if (d.preferredBranchId === deckId) d.preferredBranchId = null;
        if (d.forkedFromId === deckId) {
          // keep orphaned forks but clear source pointer
          d.forkedFromId = null;
        }
      }
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed" };
  }

  revalidatePath("/decks");
  revalidatePath("/dashboard");
  redirect("/decks");
}

const cardInputSchema = z.object({
  scryfallId: z.string().min(1),
  cardName: z.string().min(1),
  imageUri: z.string().nullable().optional(),
  manaCost: z.string().nullable().optional(),
  typeLine: z.string().min(1),
  colors: z.array(z.string()).optional().default([]),
  oracleText: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

export async function addCardToDeckAction(
  deckId: string,
  input: z.infer<typeof cardInputSchema>,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = cardInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid card" };
  }

  try {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canEditDeck(deck, user.id)) {
        throw new Error("You cannot edit this deck");
      }

      const existing = store.deckCards.find(
        (c) => c.deckId === deckId && c.scryfallId === parsed.data.scryfallId,
      );

      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + (parsed.data.quantity ?? 1));
      } else {
        store.deckCards.push({
          id: uuidv4(),
          deckId,
          scryfallId: parsed.data.scryfallId,
          cardName: parsed.data.cardName,
          imageUri: parsed.data.imageUri ?? null,
          manaCost: parsed.data.manaCost ?? null,
          typeLine: parsed.data.typeLine,
          colors: parsed.data.colors ?? [],
          oracleText: parsed.data.oracleText ?? null,
          quantity: parsed.data.quantity ?? 1,
          createdAt: new Date().toISOString(),
        });
      }

      deck.updatedAt = new Date().toISOString();
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add card" };
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
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
    return { error: "Quantity must be between 0 and 99" };
  }

  try {
    await updateStore((store) => {
      const deck = store.decks.find((d) => d.id === deckId);
      if (!deck || !canEditDeck(deck, user.id)) {
        throw new Error("You cannot edit this deck");
      }

      if (quantity === 0) {
        store.deckCards = store.deckCards.filter((c) => !(c.id === cardId && c.deckId === deckId));
      } else {
        const card = store.deckCards.find((c) => c.id === cardId && c.deckId === deckId);
        if (!card) throw new Error("Card not found in deck");
        card.quantity = quantity;
      }

      deck.updatedAt = new Date().toISOString();
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update card" };
  }

  revalidatePath(`/decks/${deckId}`);
  return { success: true };
}

export async function removeCardFromDeckAction(
  deckId: string,
  cardId: string,
): Promise<ActionResult> {
  return updateCardQuantityAction(deckId, cardId, 0);
}

export async function forkDeckAction(deckId: string): Promise<ActionResult> {
  const user = await requireUser();
  let newId = "";

  try {
    await updateStore((store) => {
      const source = store.decks.find((d) => d.id === deckId);
      if (!source || !canForkDeck(store, source, user.id)) {
        throw new Error("You are not allowed to fork this deck");
      }

      const now = new Date().toISOString();
      newId = uuidv4();
      const branch: Deck = {
        id: newId,
        ownerId: user.id,
        name: `${source.name} (branch)`,
        format: source.format,
        notes: source.notes,
        visibility: source.visibility === "public" ? "friends" : source.visibility,
        allowForks: true,
        forkedFromId: source.id,
        preferredBranchId: null,
        createdAt: now,
        updatedAt: now,
      };
      store.decks.push(branch);

      const sourceCards = store.deckCards.filter((c) => c.deckId === source.id);
      for (const card of sourceCards) {
        const copy: DeckCard = {
          ...card,
          id: uuidv4(),
          deckId: newId,
          createdAt: now,
        };
        store.deckCards.push(copy);
      }
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Fork failed" };
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

  try {
    await updateStore((store) => {
      const source = store.decks.find((d) => d.id === sourceDeckId);
      if (!source || !canEditDeck(source, user.id)) {
        throw new Error("Only the source deck owner can set a preferred branch");
      }
      if (branchId) {
        const branch = store.decks.find((d) => d.id === branchId);
        if (!branch || branch.forkedFromId !== sourceDeckId) {
          throw new Error("Branch does not belong to this deck");
        }
      }
      source.preferredBranchId = branchId;
      source.updatedAt = new Date().toISOString();
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not set preferred branch" };
  }

  revalidatePath(`/decks/${sourceDeckId}`);
  revalidatePath(`/decks/${sourceDeckId}/compare`);
  return { success: true };
}
