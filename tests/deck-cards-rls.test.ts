import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Fork import writes deck_cards through the owner's session. The existing
// "Owners manage deck cards" policy already limits insert, update, and
// delete to the deck owner. This test fails if a later migration drops
// that policy, so a new migration is not required for the write check.

const migrationsDir = path.resolve(__dirname, "../supabase/migrations");
const policy = "Owners manage deck cards";

describe("deck_cards owner write policy", () => {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  it("keeps owner-only writes in the initial policy", () => {
    const initial = readFileSync(path.join(migrationsDir, "001_initial.sql"), "utf8");
    const start = initial.indexOf(`create policy "${policy}"`);
    expect(start).toBeGreaterThan(-1);
    const body = initial.slice(start, initial.indexOf("create policy", start + 10));
    expect(body).toContain("on public.deck_cards for all");
    expect(body).toContain("to authenticated");
    const ownerChecks = body.match(/d\.owner_id = auth\.uid\(\)/g) ?? [];
    expect(ownerChecks.length).toBeGreaterThanOrEqual(2);
    expect(body).toContain("using (");
    expect(body).toContain("with check (");
  });

  it("is not dropped by a later migration", () => {
    const drops = files
      .filter((name) => name !== "001_initial.sql")
      .filter((name) => {
        const text = readFileSync(path.join(migrationsDir, name), "utf8");
        return new RegExp(`drop policy[^;]*${policy}`, "i").test(text);
      });
    expect(drops).toEqual([]);
  });
});
