import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStore, updateStore, storePath } from "@/lib/data/store";
import type { Deck } from "@/lib/types";

// Cipher PR #3 review H1: the real JSON store, on a temp directory.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spellbranch-store-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const file = () => storePath();
const dataDir = () => path.dirname(file());

const deck = (id: string, visibility: Deck["visibility"] = "public"): Deck => ({
  id, ownerId: "u", name: id, format: "modern", notes: "", visibility, allowForks: true,
  forkedFromId: null, preferredBranchId: null, commander: null, createdAt: "t", updatedAt: "t",
});

describe("local store: reads", () => {
  it("a missing file is an empty store, and reading creates nothing", async () => {
    const s = await readStore();
    expect(s.users).toEqual([]);
    expect(existsSync(file())).toBe(false);
  });

  for (const [label, content] of [
    ["truncated JSON", '{"users": [ {"id": "a"'],
    ["an empty file", ""],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ] as const) {
    it(`${label}: reads and updates throw, and the file is left exactly as it was`, async () => {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(file(), content);
      await expect(readStore()).rejects.toThrow(/refusing to overwrite/);
      await expect(updateStore((s) => { s.decks.push(deck("x")); })).rejects.toThrow(/refusing to overwrite/);
      expect(readFileSync(file(), "utf8")).toBe(content);
      expect(readdirSync(dataDir())).toEqual(["store.json"]);
    });
  }
});

describe("local store: writes are atomic and serialized", () => {
  it("200 concurrent updates: no write is lost", async () => {
    await Promise.all(
      Array.from({ length: 200 }, (_, i) => updateStore((s) => { s.decks.push(deck(`d${i}`)); })),
    );
    const s = await readStore();
    expect(s.decks).toHaveLength(200);
    expect(new Set(s.decks.map((d) => d.id)).size).toBe(200);
  });

  it("a privacy change isn't reverted by concurrent unrelated writes (the review's lost update)", async () => {
    await updateStore((s) => { s.decks.push(deck("victim", "public")); });
    const others = Array.from({ length: 50 }, (_, i) =>
      updateStore(async (s) => {
        await new Promise((r) => setTimeout(r, i % 3));
        s.favorites.push({ id: `f${i}`, userId: "x", scryfallId: `s${i}`, cardName: "c", imageUri: null, manaCost: null, typeLine: null, createdAt: "t" });
      }),
    );
    const privacy = updateStore((s) => {
      s.decks.find((d) => d.id === "victim")!.visibility = "private";
    });
    await Promise.all([...others, privacy]);
    const s = await readStore();
    expect(s.decks.find((d) => d.id === "victim")?.visibility).toBe("private");
    expect(s.favorites).toHaveLength(50);
  });

  it("readers running during writes always see a complete store (no wipe)", async () => {
    await updateStore((s) => { s.users.push({ id: "u1", username: "u1", displayName: "U", avatarUrl: null, bio: "", createdAt: "t", email: "e", passwordHash: "h" }); });
    const writes = Array.from({ length: 100 }, (_, i) => updateStore((s) => { s.decks.push(deck(`d${i}`)); }));
    const reads = Array.from({ length: 300 }, async () => {
      const s = await readStore();
      expect(s.users).toHaveLength(1);
    });
    await Promise.all([...writes, ...reads]);
    const s = await readStore();
    expect(s.users).toHaveLength(1);
    expect(s.decks).toHaveLength(100);
  });

  it("a failing update writes nothing and doesn't block later updates", async () => {
    await updateStore((s) => { s.decks.push(deck("a")); });
    await expect(updateStore((s) => { s.decks.push(deck("b")); throw new Error("nope"); })).rejects.toThrow("nope");
    await updateStore((s) => { s.decks.push(deck("c")); });
    expect((await readStore()).decks.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("leaves no temp files behind", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => updateStore((s) => { s.decks.push(deck(`d${i}`)); })));
    expect(readdirSync(dataDir())).toEqual(["store.json"]);
  });
});

describe("local store: production guard", () => {
  it("refuses to read or write under NODE_ENV=production without the opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION", "");
    await expect(readStore()).rejects.toThrow(/SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION/);
    await expect(updateStore(() => undefined)).rejects.toThrow(/SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION/);
    expect(existsSync(dataDir())).toBe(false);
  });

  it("works in production with SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SPELLBRANCH_ALLOW_LOCAL_IN_PRODUCTION", "1");
    await updateStore((s) => { s.decks.push(deck("p")); });
    expect((await readStore()).decks).toHaveLength(1);
  });
});
