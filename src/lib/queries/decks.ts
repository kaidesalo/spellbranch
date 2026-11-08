import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { getSessionUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import type { DeckScope } from "@/lib/data/types";
import type { DeckWithMeta } from "@/lib/types";

// Read helpers for deck pages. Server-only (not "use server"), so none of
// these are callable as server actions. Permissions are enforced by the data
// layer (app checks locally, RLS in Supabase mode).

async function viewerId() {
  return (await getSessionUser())?.id ?? null;
}

export async function listVisibleDecks(scope: DeckScope = "mine") {
  return getRepository().listDecks(await viewerId(), scope);
}

export async function listMyBranches() {
  const user = await requireUser();
  return getRepository().listMyBranches(user.id);
}

/** Friend forks of decks the signed-in user owns. Not listMyBranches. */
export async function listFriendBranchesOnMyDecks() {
  const user = await requireUser();
  return getRepository().listFriendBranchesOnMyDecks(user.id);
}

export async function getDeckById(deckId: string): Promise<DeckWithMeta | null> {
  return getRepository().getDeck(await viewerId(), deckId);
}

export async function getCompareData(sourceId: string, branchId: string) {
  return getRepository().getCompareData(await viewerId(), sourceId, branchId);
}

export async function getDeckPermissions(deckId: string) {
  return getRepository().getDeckPermissions(await viewerId(), deckId);
}

export async function canUserFork(deckId: string) {
  return (await getDeckPermissions(deckId)).canFork;
}

export async function canUserEdit(deckId: string) {
  return (await getDeckPermissions(deckId)).canEdit;
}

export async function canUserComment(deckId: string) {
  return (await getDeckPermissions(deckId)).canComment;
}
