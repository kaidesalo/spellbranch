"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  removeFriendAction,
  respondFriendRequestAction,
  findProfileAction,
  sendFriendRequestAction,
} from "@/lib/actions/friends";
import type { Friendship, PublicProfile } from "@/lib/types";

type FriendRow = { friendship: Friendship; profile: PublicProfile };

export function FriendsPanel({
  friends,
  incoming,
  outgoing,
}: {
  friends: FriendRow[];
  incoming: FriendRow[];
  outgoing: FriendRow[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [pending, startTransition] = useTransition();

  function search() {
    if (!query.trim()) return;
    startTransition(async () => {
      const { profiles, error } = await findProfileAction(query);
      setResults(profiles);
      if (error) toast.error(error);
      else if (profiles.length === 0) toast.message("No player with that username");
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border/80 bg-card/70 p-5">
        <h2 className="font-heading text-lg font-semibold">Find friends</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by exact username. Ask your friend for theirs (it&apos;s on their
          profile page).
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="exact_username"
            aria-label="Exact username"
            autoComplete="off"
            maxLength={24}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          <Button onClick={search} disabled={pending || !query.trim()}>
            Search
          </Button>
        </div>
        {results.length > 0 && (
          <ul className="mt-4 divide-y divide-border/70 rounded-xl border border-border/70">
            {results.map((profile) => (
              <li
                key={profile.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    @{profile.username}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await sendFriendRequestAction(profile.id);
                      if (result.error) toast.error(result.error);
                      else toast.success("Friend request sent");
                    })
                  }
                >
                  Add friend
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {incoming.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold">
            Incoming requests
          </h2>
          <ul className="space-y-2">
            {incoming.map(({ friendship, profile }) => (
              <li
                key={friendship.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    @{profile.username}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await respondFriendRequestAction(
                          friendship.id,
                          true,
                        );
                        if (result.error) toast.error(result.error);
                        else toast.success("Friend added");
                      })
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await respondFriendRequestAction(
                          friendship.id,
                          false,
                        );
                        if (result.error) toast.error(result.error);
                        else toast.message("Request declined");
                      })
                    }
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold">
            Pending sent
          </h2>
          <ul className="space-y-2">
            {outgoing.map(({ friendship, profile }) => (
              <li
                key={friendship.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    Waiting for @{profile.username} to respond
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeFriendAction(friendship.id);
                      if (result.error) toast.error(result.error);
                      else toast.success("Request cancelled");
                    })
                  }
                >
                  Cancel request
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">Your friends</h2>
        {friends.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No friends yet. Search above to send your first request.
          </p>
        ) : (
          <ul className="space-y-2">
            {friends.map(({ friendship, profile }) => (
              <li
                key={friendship.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    @{profile.username}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeFriendAction(friendship.id);
                      if (result.error) toast.error(result.error);
                      else toast.success("Removed friend");
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
