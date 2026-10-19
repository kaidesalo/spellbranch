import type { CardDiff, DeckCard } from "@/lib/types";

function keyOf(card: DeckCard) {
  return card.scryfallId;
}

export function compareDeckLists(
  sourceCards: DeckCard[],
  branchCards: DeckCard[],
): CardDiff[] {
  const sourceMap = new Map<string, DeckCard>();
  const branchMap = new Map<string, DeckCard>();

  for (const card of sourceCards) {
    const existing = sourceMap.get(keyOf(card));
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      sourceMap.set(keyOf(card), { ...card });
    }
  }

  for (const card of branchCards) {
    const existing = branchMap.get(keyOf(card));
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      branchMap.set(keyOf(card), { ...card });
    }
  }

  const ids = new Set([...sourceMap.keys(), ...branchMap.keys()]);
  const diffs: CardDiff[] = [];

  for (const id of ids) {
    const source = sourceMap.get(id);
    const branch = branchMap.get(id);
    const sourceQty = source?.quantity ?? 0;
    const branchQty = branch?.quantity ?? 0;
    const sample = branch ?? source!;

    let kind: CardDiff["kind"] = "unchanged";
    if (sourceQty === 0 && branchQty > 0) kind = "added";
    else if (sourceQty > 0 && branchQty === 0) kind = "removed";
    else if (sourceQty !== branchQty) kind = "quantity";

    diffs.push({
      scryfallId: id,
      cardName: sample.cardName,
      imageUri: sample.imageUri,
      typeLine: sample.typeLine,
      manaCost: sample.manaCost,
      sourceQty,
      branchQty,
      kind,
    });
  }

  const order = { added: 0, removed: 1, quantity: 2, unchanged: 3 };
  return diffs.sort((a, b) => {
    const byKind = order[a.kind] - order[b.kind];
    if (byKind !== 0) return byKind;
    return a.cardName.localeCompare(b.cardName);
  });
}

export function summarizeDiffs(diffs: CardDiff[]) {
  return {
    added: diffs.filter((d) => d.kind === "added").length,
    removed: diffs.filter((d) => d.kind === "removed").length,
    quantity: diffs.filter((d) => d.kind === "quantity").length,
    unchanged: diffs.filter((d) => d.kind === "unchanged").length,
  };
}

/** Heuristic: cards removed + added of similar type can be called "replaced". */
export function findReplacements(diffs: CardDiff[]) {
  const removed = diffs.filter((d) => d.kind === "removed");
  const added = diffs.filter((d) => d.kind === "added");
  const pairs: Array<{ removed: CardDiff; added: CardDiff }> = [];
  const usedAdded = new Set<string>();

  for (const rem of removed) {
    const remType = rem.typeLine.split("—")[0]?.trim() ?? rem.typeLine;
    const match = added.find(
      (add) =>
        !usedAdded.has(add.scryfallId) &&
        (add.typeLine.split("—")[0]?.trim() ?? add.typeLine) === remType,
    );
    if (match) {
      usedAdded.add(match.scryfallId);
      pairs.push({ removed: rem, added: match });
    }
  }

  return pairs;
}
