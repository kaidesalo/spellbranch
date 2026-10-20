"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import {
  cardInputSchema,
  check,
  deckSchema,
  idSchema,
  isFormData,
  quantitySchema,
} from "@/lib/actions/schemas";

export type ActionResult = { error?: string; success?: boolean; id?: string };

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
  const qty = check(quantitySchema, quantity, "Quantity must be between 0 and 99");
  if (!qty.ok) return { error: qty.error };

  try {
    await getRepository().setCardQuantity(user.id, deckId, cardId, quantity);
  } catch (err) {
    return { error: userMessage(err, "Could not update card") };
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
