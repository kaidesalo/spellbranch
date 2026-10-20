import type { Friendship } from "@/lib/types";

/**
 * Friend-request rules shared by both backends (Cipher P2). They mirror the
 * friendships RLS in supabase/migrations/002_rls_fixes.sql, so local mode
 * behaves like the database:
 *
 * - A request starts `pending`, sent by the requester.
 * - Only the addressee answers it (accept / decline), and only while pending.
 * - The requester may delete the row while it is `pending` (cancel) or
 *   `accepted` (unfriend), but NOT once it is `declined`: a declined row stays
 *   and blocks re-sending. Re-sending never flips a declined row back to
 *   pending.
 * - The addressee may delete any row (unfriend, or clear a declined request).
 *   If the person who declined later sends their own request, the old declined
 *   row is cleared and a fresh pending row is created with them as requester.
 */

export const FRIEND_MESSAGES = {
  self: "You cannot friend yourself",
  notFound: "Player not found",
  alreadyFriends: "You are already friends",
  alreadySent: "Friend request already sent",
  theyAsked: "They already sent you a request. Accept it under Incoming requests.",
  declined: "Friend request declined",
  requestNotFound: "Friend request not found",
  cannotRemove: "You can't remove this request",
} as const;

export type SendDecision =
  | { kind: "create" }
  /** The caller declined the other user earlier: clear that row, then create. */
  | { kind: "replace"; deleteId: string }
  | { kind: "error"; message: string };

/** The existing row (if any) for this unordered pair, as the caller sees it. */
export function findPair(
  friendships: Friendship[],
  a: string,
  b: string,
): Friendship | undefined {
  return friendships.find(
    (f) =>
      (f.requesterId === a && f.addresseeId === b) ||
      (f.requesterId === b && f.addresseeId === a),
  );
}

export function decideSendRequest(
  existing: Friendship | undefined,
  userId: string,
  addresseeId: string,
): SendDecision {
  if (userId === addresseeId) return { kind: "error", message: FRIEND_MESSAGES.self };
  if (!existing) return { kind: "create" };

  const iAmRequester = existing.requesterId === userId;
  switch (existing.status) {
    case "accepted":
      return { kind: "error", message: FRIEND_MESSAGES.alreadyFriends };
    case "pending":
      return {
        kind: "error",
        message: iAmRequester ? FRIEND_MESSAGES.alreadySent : FRIEND_MESSAGES.theyAsked,
      };
    case "declined":
      // The requester's declined request stays declined (no re-send). The
      // addressee who declined may start over with their own request.
      return iAmRequester
        ? { kind: "error", message: FRIEND_MESSAGES.declined }
        : { kind: "replace", deleteId: existing.id };
  }
}

/** Only the addressee answers, and only a pending request. */
export function canRespond(f: Friendship, userId: string): boolean {
  return f.addresseeId === userId && f.status === "pending";
}

/** Requester: pending (cancel) or accepted (unfriend). Addressee: any status. */
export function canRemove(f: Friendship, userId: string): boolean {
  if (f.addresseeId === userId) return true;
  if (f.requesterId === userId) return f.status === "pending" || f.status === "accepted";
  return false;
}
