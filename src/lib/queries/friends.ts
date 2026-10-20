import "server-only";

import { requireUser } from "@/lib/auth/require-user";
import { readStore } from "@/lib/data/store";
import { toPublicProfile } from "@/lib/queries/profiles";
import type { Friendship } from "@/lib/types";

export async function getFriendsData() {
  const user = await requireUser();
  const store = await readStore();

  const accepted = store.friendships.filter(
    (f) =>
      f.status === "accepted" &&
      (f.requesterId === user.id || f.addresseeId === user.id),
  );

  const pendingIncoming = store.friendships.filter(
    (f) => f.status === "pending" && f.addresseeId === user.id,
  );

  const pendingOutgoing = store.friendships.filter(
    (f) => f.status === "pending" && f.requesterId === user.id,
  );

  const profileMap = new Map(
    store.users.map((u) => [u.id, toPublicProfile(u)]),
  );

  const withOther = (f: Friendship) => {
    const otherId = f.requesterId === user.id ? f.addresseeId : f.requesterId;
    return {
      friendship: f,
      profile: profileMap.get(otherId)!,
    };
  };

  return {
    friends: accepted.map(withOther).filter((x) => x.profile),
    incoming: pendingIncoming.map(withOther).filter((x) => x.profile),
    outgoing: pendingOutgoing.map(withOther).filter((x) => x.profile),
  };
}
