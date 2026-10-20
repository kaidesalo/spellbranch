import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockClient, ok } from "./helpers/supabase-mock";

// getRepository() follows SPELLBRANCH_BACKEND, and Supabase mode only ever
// uses the request-scoped server client (no service role, no admin API).

const mock = createMockClient((c) => (c.table === "decks" ? ok([]) : undefined));
const createClient = vi.fn(mock.factory);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const SUPABASE_ENV = {
  SPELLBRANCH_BACKEND: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
  SPELLBRANCH_SITE_URL: "http://localhost:3847",
};

afterEach(() => {
  vi.unstubAllEnvs();
  createClient.mockClear();
});

describe("getRepository", () => {
  it("is the local store by default", async () => {
    vi.stubEnv("SPELLBRANCH_BACKEND", "");
    const { getRepository } = await import("@/lib/data");
    const { localRepository } = await import("@/lib/data/local");
    expect(getRepository()).toBe(localRepository);
  });

  it("uses the request-scoped server client in Supabase mode", async () => {
    for (const [k, v] of Object.entries(SUPABASE_ENV)) vi.stubEnv(k, v);
    const { getRepository } = await import("@/lib/data");
    const { localRepository } = await import("@/lib/data/local");
    const repo = getRepository();
    expect(repo).not.toBe(localRepository);
    await repo.listDecks(null, "public");
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(mock.calls[0].table).toBe("decks");
  });
});

describe("data layer source rules", () => {
  const dir = path.resolve(__dirname, "../src/lib/data");
  // Code only: comments may mention what the code deliberately doesn't do.
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = readdirSync(dir).map(
    (f) => [f, stripComments(readFileSync(path.join(dir, f), "utf8"))] as const,
  );

  it("never uses a service role or the admin API", () => {
    for (const [name, text] of files) {
      expect(text, name).not.toMatch(/service[_-]?role|SERVICE_ROLE_KEY|auth\.admin|createBrowserClient/i);
    }
  });

  it("the Supabase adapter never selects an email column and reads other users via public_profiles", () => {
    const text = files.find(([n]) => n === "supabase.ts")![1];
    expect(text).not.toMatch(/email/i);
    // The only `profiles` read is the caller's own row (getOwnProfile).
    expect(text.match(/from\("profiles"\)/g)).toHaveLength(1);
    expect(text).toMatch(/from\("public_profiles"\)/);
    expect(text).toMatch(/rpc\("fork_deck"/);
    expect(text).toMatch(/rpc\("find_profile"/);
  });
});
