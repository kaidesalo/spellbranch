"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { buildImportedDeck } from "@/lib/decklist/build";
import { cardLookupKey } from "@/lib/decklist/names";
import { parseDecklist, pastedListProblem } from "@/lib/decklist/parse";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import {
  SCRYFALL_NAME_LOOKUP_MAX,
  ScryfallLookupError,
  getScryfallCardsByName,
} from "@/lib/scryfall/client";
import { importDeckSchema, isFormData } from "@/lib/actions/schemas";

export type ImportDeckResult = {
  error?: string;
  /** Set when a deck was kept. Absent when nothing was saved. */
  id?: string;
  warnings?: string[];
  /** Copies saved in the deck list. The commander is not included. */
  added?: number;
  commanderName?: string | null;
};

/**
 * Creates a deck the signed-in user owns from a pasted list.
 *
 * Moxfield and Archidekt links are not fetched. Moxfield blocks automated
 * deck downloads, and Archidekt has no supported public download; both
 * sites accept (and export) the plain-text list this parses. Each name is
 * resolved on Scryfall and stored with cardFromScryfall / commanderFromScryfall,
 * the same builders as adding a card and setting a commander. Deck colors
 * are the union of those Scryfall identities, not a value from the client.
 */
export async function importDeckAction(formData: FormData): Promise<ImportDeckResult> {
  const user = await requireUser();
  const parsedForm = parseImportForm(formData);
  if (!parsedForm.ok) return { error: parsedForm.error };

  const { name, format, visibility, allowForks, list } = parsedForm.data;
  const urlProblem = pastedListProblem(list);
  if (urlProblem) return { error: urlProblem };

  const parsed = parseDecklist(list, { commanderBlankLine: format === "commander" });
  if (parsed.commanders.length === 0 && parsed.cards.length === 0) {
    return { error: parsed.warnings[0] ?? "No cards found in that list." };
  }

  const names = uniqueNames(
    format === "commander" ? [...parsed.commanders, ...parsed.cards] : [...parsed.cards, ...parsed.commanders],
  );
  if (names.length > SCRYFALL_NAME_LOOKUP_MAX) {
    return { error: `That list has more than ${SCRYFALL_NAME_LOOKUP_MAX} different cards.` };
  }

  const allowed = await limit("deck-import", { ip: await requestIp(), userId: user.id });
  if (!allowed.ok) return limitError(allowed);

  let found;
  try {
    found = await getScryfallCardsByName(names);
  } catch (err) {
    return { error: scryfallMessage(err) };
  }

  const built = buildImportedDeck({ format, parsed, found });
  if (!built.commander && built.cards.length === 0) {
    const missing = built.warnings.filter((warning) => warning.startsWith("Couldn't find"));
    return {
      error: missing.length > 0 ? missing.slice(0, 8).join(" ") : "No cards from that list could be imported.",
    };
  }

  const repo = getRepository();
  let id: string;
  try {
    id = await repo.createDeck(user.id, {
      name,
      format,
      notes: "",
      visibility,
      allowForks,
      colors: built.colors,
    });
  } catch (err) {
    return { error: userMessage(err, "Could not create deck") };
  }

  let added = 0;
  for (const card of built.cards) {
    try {
      await repo.addCard(user.id, id, card);
      added += card.quantity;
    } catch (err) {
      built.warnings.push(userMessage(err, `Couldn't add ${card.cardName}.`));
    }
  }

  let commanderName: string | null = null;
  if (built.commander) {
    try {
      await repo.setCommander(user.id, id, built.commander);
      commanderName = built.commander.cardName;
    } catch (err) {
      built.warnings.push(userMessage(err, "Could not set the commander."));
    }
  }

  if (added === 0 && !commanderName) {
    try {
      await repo.deleteDeck(user.id, id);
    } catch (err) {
      revalidateDeck(id);
      return { error: userMessage(err, "Could not import that list."), id };
    }
    revalidateDeck();
    return { error: "None of those cards could be added." };
  }

  revalidateDeck(id);
  if (built.warnings.length === 0) redirect(`/decks/${id}`);
  return { id, warnings: built.warnings, added, commanderName };
}

function parseImportForm(formData: unknown) {
  if (!isFormData(formData)) return { ok: false as const, error: "Invalid import" };
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : undefined;
  };
  const parsed = importDeckSchema.safeParse({
    name: text("name"),
    format: text("format"),
    visibility: text("visibility"),
    allowForks: formData.get("allowForks") === "on" || formData.get("allowForks") === "true",
    list: text("list"),
  });
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }
  return { ok: true as const, data: parsed.data };
}

function uniqueNames(cards: { name: string }[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const key = cardLookupKey(card.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(card.name);
  }
  return names;
}

function scryfallMessage(err: unknown): string {
  if (err instanceof ScryfallLookupError && err.kind === "timeout") {
    return "Scryfall took too long to answer. Try again in a moment.";
  }
  if (err instanceof ScryfallLookupError && err.kind === "too-large") {
    return "Scryfall sent an unexpected answer. Try again in a moment.";
  }
  return "Could not reach Scryfall";
}

function revalidateDeck(id?: string) {
  revalidatePath("/decks");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/decks/${id}`);
}
