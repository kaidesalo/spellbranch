import type { CollectionFinish } from "@/lib/collection";
import { COLLECTION_FINISHES } from "@/lib/collection";

/** True only when both printings name the same card. Missing ids never match. */
export function sameCardOracle(
  current: string | null | undefined,
  target: string | null | undefined,
): boolean {
  return Boolean(current && target && current === target);
}

/** Current printing first. The rest keep the order they were given. */
export function printingsWithCurrentFirst<T extends { id: string }>(
  printings: readonly T[],
  currentId: string | null | undefined,
): T[] {
  if (!currentId) return [...printings];
  const current: T[] = [];
  const rest: T[] = [];
  for (const printing of printings) {
    if (printing.id === currentId) current.push(printing);
    else rest.push(printing);
  }
  return [...current, ...rest];
}

/** Finishes we can store, in the order Scryfall listed them, dropping anything else. */
export function offeredFinishes(finishes: readonly string[] | undefined): CollectionFinish[] {
  const out: CollectionFinish[] = [];
  for (const finish of finishes ?? []) {
    if ((COLLECTION_FINISHES as readonly string[]).includes(finish) && !out.includes(finish as CollectionFinish)) {
      out.push(finish as CollectionFinish);
    }
  }
  return out;
}
