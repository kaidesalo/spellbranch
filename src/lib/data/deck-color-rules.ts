import { DeckColorError } from "@/lib/data/errors";
import {
  comboFor,
  describeColors,
  fitsDeckColors,
  offColorCardNames,
  offColorReason,
  storedCardIdentity,
} from "@/lib/deck-colors";
import type { DeckCard, DeckCommander } from "@/lib/types";

/**
 * The deck-colors rules both data adapters run before they write
 * (src/lib/deck-colors.ts has the pure helpers). Each throws a
 * DeckColorError with a message that is safe to show.
 */

type StoredCard = Pick<DeckCard, "cardName" | "colors"> & { colorIdentity?: string[] | null };

const plural = (n: number) => (n === 1 ? "1 card doesn't" : `${n} cards don't`);

/**
 * Changing a deck's colors (or picking them for the first time). Never
 * removes cards: if any card or the commander falls outside, it refuses.
 */
export function assertColorsFitDeck(
  colors: string[],
  cards: readonly StoredCard[],
  commander: DeckCommander | null,
): void {
  const name = comboFor(colors).name;
  if (commander && !fitsDeckColors(commander.colorIdentity, colors)) {
    throw new DeckColorError(
      `${commander.cardName}'s color identity (${describeColors(commander.colorIdentity)}) doesn't fit ${name}. Pick colors that include it, or change the commander first.`,
    );
  }
  const off = offColorCardNames(cards, colors);
  if (off.length > 0) {
    throw new DeckColorError(
      `Can't change the deck to ${name}: ${plural(off.length)} fit. Remove ${off.length === 1 ? "it" : "them"} first, or pick wider colors.`,
      off,
    );
  }
}

/**
 * Setting a commander. With deck colors, the commander's identity must fit
 * them. Without (an older deck), the deck takes the commander's identity as
 * its colors, so the cards must fit that. Returns the colors to store.
 */
export function colorsForCommander(
  commander: DeckCommander,
  deckColors: string[] | null,
  cards: readonly StoredCard[],
): string[] {
  const identity = commander.colorIdentity;
  if (deckColors !== null) {
    if (!fitsDeckColors(identity, deckColors)) {
      throw new DeckColorError(
        `${commander.cardName}'s color identity (${describeColors(identity)}) doesn't fit this deck's colors (${describeColors(deckColors)}). Pick another commander, or widen the deck colors in Settings.`,
      );
    }
    return deckColors;
  }
  const off = offColorCardNames(cards, identity);
  if (off.length > 0) {
    throw new DeckColorError(
      `Can't make ${commander.cardName} the commander: ${plural(off.length)} fit its color identity (${describeColors(identity)}). Remove ${off.length === 1 ? "it" : "them"} first.`,
      off,
    );
  }
  return [...identity];
}

/** Adding a card (identity from Scryfall, fetched by the server). */
export function assertCardFits(
  cardName: string,
  identity: readonly string[],
  deckColors: string[] | null,
): void {
  const reason = offColorReason(identity, deckColors);
  if (reason) throw new DeckColorError(`Can't add ${cardName}: ${reason}`);
}

/**
 * Raising a stored card's quantity. Lowering or removing is always allowed,
 * so an off-color card left over from before can still be cleaned up.
 */
export function assertQuantityRaiseFits(card: StoredCard, deckColors: string[] | null): void {
  const reason = offColorReason(storedCardIdentity(card), deckColors);
  if (reason) {
    throw new DeckColorError(
      `${card.cardName} doesn't fit this deck: ${reason} You can lower its quantity or remove it.`,
    );
  }
}
