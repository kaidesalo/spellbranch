import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataError } from "@/lib/data/errors";
import { FRIEND_MESSAGES } from "@/lib/data/friend-rules";
import { createSupabaseRepository } from "@/lib/data/supabase";
import type { Repository } from "@/lib/data/types";

/**
 * Integration pass: the real Supabase adapter + supabase-js against PostgREST
 * on a local Postgres 17 with the Supabase stub, migrations 001-006 and seed.
 * Skipped unless SPELLBRANCH_IT_POSTGREST_URL is set; run it with
 * /workspace/spellbranch-pr3-rls/run_pr3_integration.sh (see the PR body).
 * There is no GoTrue: JWTs are minted with the throwaway PostgREST secret, so
 * auth flows themselves are NOT exercised here, only data access under RLS.
 */

const REST = process.env.SPELLBRANCH_IT_POSTGREST_URL;
const SECRET = process.env.SPELLBRANCH_IT_JWT_SECRET;

const ANN = "e0000000-0000-4000-8000-000000000001";
const BEN = "e0000000-0000-4000-8000-000000000002";
const CAT = "e0000000-0000-4000-8000-000000000003";
const IMG = "https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000000.jpg";

let proxy: Server;
let baseUrl: string;
/** "METHOD /path" of every request the adapter makes (no query string). */
const seen: string[] = [];
const tokens = new Map<string, string>();

async function jwt(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function clientFor(userId: string | null): SupabaseClient {
  const token = tokens.get(userId ?? "anon")!;
  return createClient(baseUrl, tokens.get("anon")!, {
    accessToken: async () => token,
    auth: { persistSession: false },
  });
}

const repoFor = (userId: string | null): Repository =>
  createSupabaseRepository(async () => clientFor(userId));

async function dataError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DataError);
    return (err as Error).message;
  }
  throw new Error("expected a DataError");
}

const card = (scryfallId: string, cardName: string, quantity = 1) => ({
  scryfallId, cardName, imageUri: IMG, manaCost: "{1}", typeLine: "Artifact",
  colors: [], colorIdentity: [], oracleText: null, quantity,
});

describe.skipIf(!REST || !SECRET)("Supabase adapter against PostgREST + PG17 stub", () => {
  beforeAll(async () => {
    if (typeof globalThis.WebSocket === "undefined") vi.stubGlobal("WebSocket", class {});
    tokens.set("anon", await jwt({ role: "anon" }));
    for (const id of [ANN, BEN, CAT]) {
      tokens.set(id, await jwt({ sub: id, role: "authenticated", aud: "authenticated" }));
    }
    // supabase-js talks to <url>/rest/v1; PostgREST serves at /.
    const target = new URL(REST!);
    proxy = createServer((req, res) => {
      seen.push(`${req.method} ${(req.url ?? "/").replace(/^\/rest\/v1/, "").split("?")[0]}`);
      const upstream = request(
        {
          host: target.hostname,
          port: target.port,
          method: req.method,
          path: (req.url ?? "/").replace(/^\/rest\/v1/, ""),
          headers: { ...req.headers, host: target.host },
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      req.pipe(upstream);
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => (proxy ? proxy.close(() => r()) : r())));

  const ann = () => repoFor(ANN);
  const ben = () => repoFor(BEN);
  const cat = () => repoFor(CAT);
  const anon = () => repoFor(null);
  let deckId = "";
  let forkId = "";

  it("decks + cards: create, add, read signed out with public_profiles names", async () => {
    deckId = await ann().createDeck(ANN, {
      name: "IT public", format: "modern", notes: "n", visibility: "public", allowForks: true,
    });
    await ann().addCard(ANN, deckId, card("s1", "Sol Ring"));
    await ann().addCard(ANN, deckId, card("s1", "Sol Ring", 2));
    await ann().addCard(ANN, deckId, { ...card("s2", "Mox"), imageUri: "https://evil.example/p.png" });
    expect(await dataError(ben().addCard(BEN, deckId, card("s3", "X")))).toBe("You cannot edit this deck");

    const deck = await anon().getDeck(null, deckId);
    expect(deck?.cardCount).toBe(4);
    expect(deck?.cards?.find((c) => c.scryfallId === "s2")?.imageUri).toBeNull();
    expect(deck?.owner).toEqual({ id: ANN, username: "it_ann", displayName: "Ann", avatarUrl: null });

    const pub = await anon().listDecks(null, "public");
    expect(pub.map((d) => d.id)).toContain(deckId);
    expect(JSON.stringify(pub)).not.toMatch(/corp\.example|example\.test|email/);
  });

  it("forks go through fork_deck(); compare needs visibility; preferred branch by UPDATE", async () => {
    forkId = await ben().forkDeck(BEN, deckId);
    const fork = await ben().getDeck(BEN, forkId);
    expect(fork).toMatchObject({ ownerId: BEN, forkedFromId: deckId, visibility: "friends", cardCount: 4 });
    expect(fork?.sourceDeck?.id).toBe(deckId);

    const forkCard = fork!.cards!.find((c) => c.scryfallId === "s1")!;
    await ben().setCardQuantity(BEN, forkId, forkCard.id, 1);
    expect((await anon().getDeck(null, deckId))?.cardCount).toBe(4); // source untouched

    // Ben's branch is friends-only and they aren't friends yet.
    expect(await ann().getCompareData(ANN, deckId, forkId)).toBeNull();
    expect(await dataError(ann().setPreferredBranch(ANN, deckId, forkId))).toBe(
      "Branch does not belong to this deck",
    );
    expect(await dataError(ben().setPreferredBranch(BEN, deckId, forkId))).toMatch(/source deck owner/);
  });

  it("the DB rejects preferred_branch_id on INSERT (why the adapter never sends it)", async () => {
    const { error } = await clientFor(ANN)
      .from("decks")
      .insert({ owner_id: ANN, name: "x", format: "modern", visibility: "private", preferred_branch_id: forkId });
    expect(error?.code).toBe("23514");
  });

  it("friends: exact find_profile, request, decline, no re-send, decliner starts over, accept", async () => {
    expect((await ann().findProfile(ANN, "IT_BEN")).map((p) => p.username)).toEqual(["it_ben"]);
    expect(await ann().findProfile(ANN, "it_be")).toEqual([]);
    expect(await ann().findProfile(ANN, "it_ann")).toEqual([]);
    expect(await anon().findProfile("", "it_ben").catch((e) => e)).toBeInstanceOf(Error); // anon can't call it

    await ann().sendFriendRequest(ANN, BEN);
    expect(await dataError(ann().sendFriendRequest(ANN, BEN))).toBe(FRIEND_MESSAGES.alreadySent);
    expect(await dataError(ben().sendFriendRequest(BEN, ANN))).toBe(FRIEND_MESSAGES.theyAsked);
    const incoming = (await ben().getFriendsData(BEN)).incoming;
    expect(incoming.map((r) => r.profile.username)).toEqual(["it_ann"]);
    const fid = incoming[0].friendship.id;

    expect(await dataError(ann().respondFriendRequest(ANN, fid, true))).toBe(FRIEND_MESSAGES.requestNotFound);
    await ben().respondFriendRequest(BEN, fid, false);

    expect(await dataError(ann().sendFriendRequest(ANN, BEN))).toBe(FRIEND_MESSAGES.declined);
    expect(await dataError(ann().removeFriendship(ANN, fid))).toBe(FRIEND_MESSAGES.cannotRemove);
    // Even bypassing the adapter's checks, the DB keeps the declined row.
    const del = await clientFor(ANN).from("friendships").delete().eq("id", fid).select("id");
    expect(del.data).toEqual([]);
    const ins = await clientFor(ANN).from("friendships").insert({ requester_id: ANN, addressee_id: BEN, status: "pending" });
    expect(ins.error?.code).toBe("23505");
    const row = await clientFor(BEN).from("friendships").select("status").eq("id", fid).single();
    expect(row.data?.status).toBe("declined");

    // Ben (who declined) changes his mind: old row cleared and fresh request
    // created by ONE restart_friend_request() call (003, review I1).
    seen.length = 0;
    await ben().sendFriendRequest(BEN, ANN);
    expect(seen).toEqual(["GET /friendships", "POST /rpc/restart_friend_request"]);
    const restarted = await clientFor(BEN).from("friendships").select("id, requester_id, status");
    expect(restarted.data).toHaveLength(1);
    expect(restarted.data![0]).toMatchObject({ requester_id: BEN, status: "pending" });
    expect(restarted.data![0].id).not.toBe(fid);
    const annIncoming = (await ann().getFriendsData(ANN)).incoming;
    expect(annIncoming.map((r) => r.profile.username)).toEqual(["it_ben"]);
    await ann().respondFriendRequest(ANN, annIncoming[0].friendship.id, true);
    expect((await ann().getFriendsData(ANN)).friends.map((r) => r.profile.username)).toEqual(["it_ben"]);
  });

  it("once friends, compare + preferred branch work", async () => {
    const cmp = await ann().getCompareData(ANN, deckId, forkId);
    expect(cmp?.canSetPreferred).toBe(true);
    expect(cmp?.branch.cardCount).toBe(2); // s1 x1 + s2 x1
    await ann().setPreferredBranch(ANN, deckId, forkId);
    expect((await ann().getDeck(ANN, deckId))?.preferredBranchId).toBe(forkId);
    await ann().setPreferredBranch(ANN, deckId, null);
  });

  it("L1: a preferred branch the viewer can't see comes back as null", async () => {
    await ann().setPreferredBranch(ANN, deckId, forkId); // Ben's friends-only fork
    expect((await ann().getDeck(ANN, deckId))?.preferredBranchId).toBe(forkId);
    for (const viewer of [anon(), cat()]) {
      const deck = await viewer.getDeck(null, deckId);
      expect(deck?.preferredBranchId).toBeNull();
      expect(deck?.branches).toEqual([]);
    }
    await ann().setPreferredBranch(ANN, deckId, null);
  });

  it("L2: the DB enforces the length limits even for direct API writes", async () => {
    const own = await ann().createDeck(ANN, { name: "Limits", format: "modern", notes: "", visibility: "private", allowForks: true });
    const db = clientFor(ANN);
    expect((await db.from("decks").update({ name: "n".repeat(81) }).eq("id", own)).error?.code).toBe("23514");
    expect((await db.from("decks").update({ notes: "x".repeat(2001) }).eq("id", own)).error?.code).toBe("23514");
    const base = { deck_id: own, scryfall_id: "lim", card_name: "c", type_line: "t", quantity: 1 };
    expect((await db.from("deck_cards").insert({ ...base, oracle_text: "o".repeat(4001) })).error?.code).toBe("23514");
    expect((await db.from("deck_cards").insert({ ...base, colors: ["X"] })).error?.code).toBe("23514");
    expect((await db.from("favorite_cards").insert({ user_id: ANN, scryfall_id: "lim", card_name: "c".repeat(201) })).error?.code).toBe("23514");
    // At the limit is fine, through the adapter.
    await ann().updateDeck(ANN, own, { name: "n".repeat(80), format: "modern", notes: "x".repeat(2000), visibility: "private", allowForks: true });
    await ann().deleteDeck(ANN, own);
  });

  it("requester can cancel a pending request; strangers can't touch it", async () => {
    await cat().sendFriendRequest(CAT, ANN);
    const out = (await cat().getFriendsData(CAT)).outgoing;
    expect(out).toHaveLength(1);
    expect(await dataError(ben().removeFriendship(BEN, out[0].friendship.id))).toBe(
      FRIEND_MESSAGES.requestNotFound,
    );
    await cat().removeFriendship(CAT, out[0].friendship.id);
    expect((await ann().getFriendsData(ANN)).incoming).toEqual([]);
  });

  it("comments: signed-in post, signed-out read with names; no comments on invisible decks", async () => {
    await ben().addComment(BEN, deckId, "nice list");
    const comments = await anon().listComments(null, deckId);
    expect(comments.map((c) => [c.body, c.author?.username])).toEqual([["nice list", "it_ben"]]);

    const priv = await ann().createDeck(ANN, {
      name: "IT private", format: "modern", notes: "", visibility: "private", allowForks: false,
    });
    expect(await dataError(cat().addComment(CAT, priv, "hi"))).toBe("You cannot comment on this deck");
    expect(await cat().getDeck(CAT, priv)).toBeNull();
    expect(await dataError(cat().forkDeck(CAT, priv))).toBe("You are not allowed to fork this deck");
    expect(await cat().getDeckPermissions(CAT, priv)).toEqual({ canEdit: false, canFork: false, canComment: false });
    await ann().deleteDeck(ANN, priv);
  });

  it("favorites: add (duplicate ok), list, remove", async () => {
    const fav = { scryfallId: "s1", cardName: "Sol Ring", imageUri: IMG, manaCost: "{1}", typeLine: "Artifact" };
    await cat().addFavorite(CAT, fav);
    await cat().addFavorite(CAT, fav);
    const list = await cat().listFavorites(CAT);
    expect(list).toHaveLength(1);
    expect(await ann().listFavorites(ANN)).toEqual([]);
    await ann().removeFavorite(ANN, list[0].id); // not hers: no-op
    expect(await cat().listFavorites(CAT)).toHaveLength(1);
    await cat().removeFavorite(CAT, list[0].id);
    expect(await cat().listFavorites(CAT)).toEqual([]);
  });

  it("deck settings and delete: owner only; forks survive with forked_from_id cleared", async () => {
    const input = { name: "IT renamed", format: "modern" as const, notes: "", visibility: "public" as const, allowForks: true };
    expect(await dataError(ben().updateDeck(BEN, deckId, input))).toBe("You cannot edit this deck");
    await ann().updateDeck(ANN, deckId, input);
    expect((await anon().getDeck(null, deckId))?.name).toBe("IT renamed");
    expect(await dataError(ben().deleteDeck(BEN, deckId))).toBe("You cannot delete this deck");
    await ann().deleteDeck(ANN, deckId);
    const fork = await ben().getDeck(BEN, forkId);
    expect(fork?.forkedFromId).toBeNull();
    expect(fork?.cardCount).toBe(2);
  });

  it("commander (006): owner sets/clears, others read only, format change clears, forks copy", async () => {
    const legend = {
      scryfallId: "11111111-2222-4333-8444-555555555555", cardName: "Test Legend",
      typeLine: "Legendary Creature — Elf", manaCost: "{2}{G}", imageUri: IMG,
      artUri: "https://cards.scryfall.io/art_crop/front/0/0/x.jpg", colorIdentity: ["G"],
    };
    const edh = await ann().createDeck(ANN, { name: "EDH", format: "commander", notes: "", visibility: "public", allowForks: true });
    await ann().setCommander(ANN, edh, legend);
    expect((await anon().getDeck(null, edh))?.commander).toEqual(legend);
    expect((await anon().listDecks(null, "public")).find((d) => d.id === edh)?.commander?.cardName).toBe("Test Legend");

    expect(await dataError(ben().setCommander(BEN, edh, null))).toBe("You cannot edit this deck");
    // Direct API write by a non-owner: RLS filters the row out.
    const { data: hijack } = await clientFor(BEN).from("decks")
      .update({ commander_name: "Hijack" }).eq("id", edh).select("id");
    expect(hijack).toEqual([]);
    // Direct API write by the owner can't bypass the type-line CHECK.
    const { error: bad } = await clientFor(ANN).from("decks")
      .update({ commander_type_line: "Legendary Artifact" }).eq("id", edh);
    expect(bad?.code).toBe("23514");

    const fork = await ben().forkDeck(BEN, edh);
    expect((await ben().getDeck(BEN, fork))?.commander).toEqual(legend);

    await ann().updateDeck(ANN, edh, { name: "EDH", format: "modern", notes: "", visibility: "public", allowForks: true });
    expect((await anon().getDeck(null, edh))?.commander).toBeNull();
    expect(await dataError(ann().setCommander(ANN, edh, legend))).toBe("Only Commander decks have a commander");
  });

  it("own profile comes from profiles; nobody's email is selectable", async () => {
    expect(await ann().getOwnProfile(ANN)).toEqual({ id: ANN, username: "it_ann", displayName: "Ann", bio: "" });
    const { error } = await clientFor(ANN).from("profiles").update({ bio: "x".repeat(281) }).eq("id", ANN);
    expect(error?.code).toBe("23514"); // 003
    const anonRead = await clientFor(null).from("profiles").select("bio").limit(1);
    expect(anonRead.error).not.toBeNull(); // anon has column grants for the public columns only
  });
});
