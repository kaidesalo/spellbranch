"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";

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

function parseDeckForm(formData: FormData) {
  return deckSchema.safeParse({
    name: formData.get("name"),
    format: formData.get("format"),
    notes: formData.get("notes") ?? "",
    visibility: formData.get("visibility"),
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

  try {
    await getRepository().deleteDeck(user.id, deckId);
  } catch (err) {
    return { error: userMessage(err, "Delete failed") };
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
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
    return { error: "Quantity must be between 0 and 99" };
  }

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

  try {
    await getRepository().setPreferredBranch(user.id, sourceDeckId, branchId);
  } catch (err) {
    return { error: userMessage(err, "Could not set preferred branch") };
  }

  revalidatePath(`/decks/${sourceDeckId}`);
  revalidatePath(`/decks/${sourceDeckId}/compare`);
  return { success: true };
}
