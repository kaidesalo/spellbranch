import type { CollectionCard } from "@/lib/types";

/**
 * A card sitting in one of the signed-in user's decks (any board) or in the
 * commander slot. Built from deck rows the owner can already read.
 */
export type DeckCardRef = {
  deckId: string;
  deckName: string;
  scryfallId: string;
  cardName: string;
};

export type DeckLink = { id: string; name: string };

/** One owned card name, with every printing pile still intact. */
export type CollectionGroup = {
  name: string;
  quantity: number;
  piles: CollectionCard[];
  decks: DeckLink[];
};

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function sameCard(pile: CollectionCard, ref: DeckCardRef): boolean {
  if (pile.scryfallId.toLowerCase() === ref.scryfallId.toLowerCase()) return true;
  return nameKey(pile.cardName) === nameKey(ref.cardName);
}

/** Decks that contain this pile's printing or the same card name. */
export function decksForPile(pile: CollectionCard, refs: readonly DeckCardRef[]): DeckLink[] {
  const seen = new Map<string, DeckLink>();
  for (const ref of refs) {
    if (!sameCard(pile, ref) || seen.has(ref.deckId)) continue;
    seen.set(ref.deckId, { id: ref.deckId, name: ref.deckName });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function groupPiles(piles: readonly CollectionCard[], refs: readonly DeckCardRef[]): CollectionGroup[] {
  const byName = new Map<string, CollectionCard[]>();
  for (const pile of piles) {
    const key = nameKey(pile.cardName);
    const list = byName.get(key);
    if (list) list.push(pile);
    else byName.set(key, [pile]);
  }
  const groups: CollectionGroup[] = [];
  for (const list of byName.values()) {
    const decks = new Map<string, DeckLink>();
    for (const pile of list) {
      for (const deck of decksForPile(pile, refs)) decks.set(deck.id, deck);
    }
    groups.push({
      name: list[0]!.cardName,
      quantity: list.reduce((sum, pile) => sum + pile.quantity, 0),
      piles: [...list].sort(
        (a, b) =>
          a.finish.localeCompare(b.finish) ||
          (a.condition ?? "").localeCompare(b.condition ?? "") ||
          a.id.localeCompare(b.id),
      ),
      decks: [...decks.values()].sort((a, b) => a.name.localeCompare(b.name, "en")),
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return groups;
}

/** Every owned pile, grouped by card name. Quantities are summed. Piles stay editable. */
export function fullCollection(
  cards: readonly CollectionCard[],
  refs: readonly DeckCardRef[] = [],
): CollectionGroup[] {
  return groupPiles(cards, refs);
}

/** Owned piles whose card shows up in at least one of the user's decks. */
export function inDecks(
  cards: readonly CollectionCard[],
  refs: readonly DeckCardRef[],
): CollectionGroup[] {
  const used = cards.filter((pile) => decksForPile(pile, refs).length > 0);
  return groupPiles(used, refs);
}

export type OwnedDeck = { id: string; name: string };

/** One section per owned deck. Groups are the owned piles in that deck, commander included. */
export type DeckBinder = {
  id: string;
  name: string;
  groups: CollectionGroup[];
};

/**
 * One binder per deck the user owns. A pile is included when its printing or
 * card name matches a deck card or the commander slot. The same owned pile
 * can sit in more than one binder.
 */
export function deckBinders(
  cards: readonly CollectionCard[],
  refs: readonly DeckCardRef[],
  decks: readonly OwnedDeck[] = [],
): DeckBinder[] {
  const byId = new Map<string, OwnedDeck>();
  for (const deck of decks) {
    if (!byId.has(deck.id)) byId.set(deck.id, { id: deck.id, name: deck.name });
  }
  for (const ref of refs) {
    if (!byId.has(ref.deckId)) byId.set(ref.deckId, { id: ref.deckId, name: ref.deckName });
  }

  const binders: DeckBinder[] = [];
  for (const deck of byId.values()) {
    const deckRefs = refs.filter((ref) => ref.deckId === deck.id);
    const piles = cards.filter((pile) => deckRefs.some((ref) => sameCard(pile, ref)));
    binders.push({ id: deck.id, name: deck.name, groups: groupPiles(piles, deckRefs) });
  }
  binders.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  return binders;
}

/** Piles with for_trade set. The flag is on the pile, not a separate binder table. */
export function tradeBinder(
  cards: readonly CollectionCard[],
  refs: readonly DeckCardRef[] = [],
): CollectionGroup[] {
  return groupPiles(
    cards.filter((pile) => pile.forTrade),
    refs,
  );
}
