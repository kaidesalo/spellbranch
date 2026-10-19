import { requireUser } from "@/lib/actions/auth";
import { getFriendsData } from "@/lib/actions/friends";
import { FriendsPanel } from "@/components/friends/friends-panel";

export default async function FriendsPage() {
  await requireUser();
  const data = await getFriendsData();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Friends</h1>
      <p className="mt-1 text-muted-foreground">
        Connect with players so you can share friends-only decks and collaborate.
      </p>
      <div className="mt-8">
        <FriendsPanel
          friends={data.friends}
          incoming={data.incoming}
          outgoing={data.outgoing}
        />
      </div>
    </div>
  );
}
