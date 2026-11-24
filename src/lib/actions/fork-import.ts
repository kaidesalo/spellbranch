"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require-user";
import { getRepository, userMessage } from "@/lib/data";
import { DeckColorError } from "@/lib/data/errors";
import { forkImportListSchema, idSchema, isFormData } from "@/lib/actions/schemas";
import { buildImportedDeck } from "@/lib/decklist/build";
import { cardLookupKey } from "@/lib/decklist/names";
import { parseDecklist, pastedListProblem } from "@/lib/decklist/parse";
import {
  diffImportAgainstOriginal,
  type ImportBoard,
  type ImportDiffRow,
} from "@/lib/fork-import-diff";
import {
  FORK_IMPORT_DENIED,
  FORK_IMPORT_NOT_A_FORK,
  FORK_IMPORT_SOURCE_HIDDEN,
} from "@/lib/fork-import";
import { limit, limitError, requestIp } from "@/lib/rate-limit";
import {
  SCRYFALL_NAME_LOOKUP_MAX,
  ScryfallLookupError,
  getScryfallCardsByName,
} from "@/lib/scryfall/client";
import type { DeckWithMeta } from "@/lib/types";

export type ForkImportChange = Pick<
  ImportDiffRow,
  "scryfallId" | "cardName" | "manaCost" | "typeLine" | "board" | "kind" | "originalQty" | "importQty"
> & { board: ImportBoard; kind: "added" | "removed" | "quantity" };

export type ForkImportPreview = {
  originalName: string;
  warnings: string[];
  summary: { added: number; removed: number; quantity: number; unchanged: number };
  changes: ForkImportChange[];
  commanderChange: "none" | "same" | "added" | "removed" | "changed";
  commanderOriginalName: string | null;
  commanderImportName: string | null;
};

export type ForkImportResult = {
  error?: string;
  /** Set when the list was checked and nothing was written yet. */
  preview?: ForkImportPreview;
  /** Set after the branch's cards were replaced. */
  saved?: boolean;
  retryAfterSec?: number;
};

/**
 * Imports a pasted deck list onto a fork the signed-in user owns.
 *
 * Without `confirm=true` this only returns a diff against the original
 * deck (`forked_from_id`). Nothing is written. With `confirm=true` the
 * same checks run again and the fork's cards are replaced. The original
 * deck is never written.
 *
 * The list is parsed and resolved with the same helpers as a new-deck
 * import (parseDecklist, getScryfallCardsByName, buildImportedDeck), so
 * double-faced names resolve the same way. Card text comes from Scryfall,
 * not from the paste.
 */
export async function importForkDecklistAction(
  deckId: string,
  formData: FormData,
): Promise<ForkImportResult> {
  const user = await requireUser();
  if (!idSchema.safeParse(deckId).success) return { error: FORK_IMPORT_DENIED };
  const parsedForm = parseListForm(formData);
  if (!parsedForm.ok) return { error: parsedForm.error };

  const repo = getRepository();
  let deck: DeckWithMeta | null;
  try {
    deck = await repo.getDeck(user.id, deckId);
  } catch (err) {
    return { error: userMessage(err, "Could not import that list.") };
  }
  if (!deck || deck.ownerId !== user.id || deck.isPrecon) return { error: FORK_IMPORT_DENIED };
  if (!deck.forkedFromId) return { error: FORK_IMPORT_NOT_A_FORK };

  let original: DeckWithMeta | null;
  try {
    original = await repo.getDeck(user.id, deck.forkedFromId);
  } catch (err) {
    return { error: userMessage(err, "Could not import that list.") };
  }
  if (!original) return { error: FORK_IMPORT_SOURCE_HIDDEN };

  const urlProblem = pastedListProblem(parsedForm.list);
  if (urlProblem) return { error: urlProblem };

  const parsed = parseDecklist(parsedForm.list, { commanderBlankLine: deck.format === "commander" });
  if (parsed.commanders.length === 0 && parsed.cards.length === 0) {
    return { error: parsed.warnings[0] ?? "No cards found in that list." };
  }

  const names = uniqueNames(
    deck.format === "commander"
      ? [...parsed.commanders, ...parsed.cards]
      : [...parsed.cards, ...parsed.commanders],
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

  const built = buildImportedDeck({ format: deck.format, parsed, found });
  if (!built.commander && built.cards.length === 0) {
    const missing = built.warnings.filter((warning) => warning.startsWith("Couldn't find"));
    return {
      error: missing.length > 0 ? missing.slice(0, 8).join(" ") : "No cards from that list could be imported.",
    };
  }

  const originalCommander = original.format === "commander" ? original.commander : null;
  const importedCommander = deck.format === "commander" ? built.commander : null;
  const diff = diffImportAgainstOriginal({
    originalCards: (original.cards ?? []).map((card) => ({
      scryfallId: card.scryfallId,
      cardName: card.cardName,
      manaCost: card.manaCost,
      typeLine: card.typeLine,
      quantity: card.quantity,
      board: card.board,
    })),
    originalCommander,
    importedCards: built.cards,
    importedCommander,
  });

  const preview: ForkImportPreview = {
    originalName: original.name,
    warnings: built.warnings,
    summary: diff.summary,
    changes: diff.changes.map((row) => ({
      scryfallId: row.scryfallId,
      cardName: row.cardName,
      manaCost: row.manaCost,
      typeLine: row.typeLine,
      board: row.board,
      kind: row.kind as ForkImportChange["kind"],
      originalQty: row.originalQty,
      importQty: row.importQty,
    })),
    commanderChange: diff.commanderChange,
    commanderOriginalName: originalCommander?.cardName ?? null,
    commanderImportName: importedCommander?.cardName ?? null,
  };

  if (!parsedForm.confirm) return { preview };

  try {
    await repo.replaceForkList(user.id, deck.id, {
      cards: built.cards,
      commander: importedCommander,
      colors: built.colors,
    });
  } catch (err) {
    if (err instanceof DeckColorError) return { error: err.message, preview };
    return { error: userMessage(err, "Could not import that list."), preview };
  }

  revalidatePath("/decks");
  revalidatePath(`/decks/${deck.id}`);
  revalidatePath("/my-cards");
  revalidatePath("/dashboard");
  return { saved: true, preview };
}

function parseListForm(formData: unknown): { ok: true; list: string; confirm: boolean } | { ok: false; error: string } {
  if (!isFormData(formData)) return { ok: false, error: "Invalid import" };
  const list = formData.get("list");
  const parsed = forkImportListSchema.safeParse({ list: typeof list === "string" ? list : "" });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import" };
  }
  return { ok: true, list: parsed.data.list, confirm: formData.get("confirm") === "true" };
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
