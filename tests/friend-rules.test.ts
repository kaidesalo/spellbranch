import { describe, expect, it } from "vitest";
import {
  FRIEND_MESSAGES,
  canRemove,
  canRespond,
  decideSendRequest,
  findPair,
} from "@/lib/data/friend-rules";
import type { Friendship, FriendshipStatus } from "@/lib/types";

// The P2 rules both adapters share; they mirror the friendships RLS in 002.

const row = (requesterId: string, addresseeId: string, status: FriendshipStatus): Friendship => ({
  id: "f1",
  requesterId,
  addresseeId,
  status,
  createdAt: "2026-10-20T14:00:00.000Z",
});

describe("decideSendRequest", () => {
  it("creates when there is no row", () => {
    expect(decideSendRequest(undefined, "a", "b")).toEqual({ kind: "create" });
  });

  it("refuses yourself", () => {
    expect(decideSendRequest(undefined, "a", "a")).toEqual({ kind: "error", message: FRIEND_MESSAGES.self });
  });

  it.each([
    [row("a", "b", "pending"), FRIEND_MESSAGES.alreadySent],
    [row("b", "a", "pending"), FRIEND_MESSAGES.theyAsked],
    [row("a", "b", "accepted"), FRIEND_MESSAGES.alreadyFriends],
    [row("b", "a", "accepted"), FRIEND_MESSAGES.alreadyFriends],
    [row("a", "b", "declined"), FRIEND_MESSAGES.declined],
  ])("%o -> %s", (existing, message) => {
    expect(decideSendRequest(existing, "a", "b")).toEqual({ kind: "error", message });
  });

  it("never turns a declined request back into a pending one for the requester", () => {
    const declined = row("a", "b", "declined");
    const decision = decideSendRequest(declined, "a", "b");
    expect(decision.kind).toBe("error");
    expect(declined.status).toBe("declined");
  });

  it("lets the user who declined start over (clear + create)", () => {
    expect(decideSendRequest(row("b", "a", "declined"), "a", "b")).toEqual({ kind: "replace", deleteId: "f1" });
  });
});

describe("canRespond / canRemove", () => {
  it("only the addressee answers, and only while pending", () => {
    expect(canRespond(row("a", "b", "pending"), "b")).toBe(true);
    expect(canRespond(row("a", "b", "pending"), "a")).toBe(false);
    expect(canRespond(row("a", "b", "pending"), "c")).toBe(false);
    expect(canRespond(row("a", "b", "declined"), "b")).toBe(false);
    expect(canRespond(row("a", "b", "accepted"), "b")).toBe(false);
  });

  it("requester: pending or accepted only; addressee: anything; others: nothing", () => {
    expect(canRemove(row("a", "b", "pending"), "a")).toBe(true);
    expect(canRemove(row("a", "b", "accepted"), "a")).toBe(true);
    expect(canRemove(row("a", "b", "declined"), "a")).toBe(false);
    for (const s of ["pending", "accepted", "declined"] as const) {
      expect(canRemove(row("a", "b", s), "b")).toBe(true);
      expect(canRemove(row("a", "b", s), "c")).toBe(false);
    }
  });

  it("findPair matches either direction", () => {
    const f = row("b", "a", "pending");
    expect(findPair([f], "a", "b")).toBe(f);
    expect(findPair([f], "a", "c")).toBeUndefined();
  });
});
