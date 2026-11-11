import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(__dirname, "../supabase/migrations/012_profile_bio_friends_only.sql"),
  "utf8",
);

describe("migration 012", () => {
  it("revokes table SELECT and leaves bio out of the column grants", () => {
    expect(sql).toMatch(/revoke select on table public\.profiles from public, anon, authenticated/);
    expect(sql).toMatch(/revoke select \(bio\) on table public\.profiles from public, anon, authenticated/);
    expect(sql).toMatch(
      /grant select \(id, username, display_name, avatar_url\)\s+on table public\.profiles to anon/,
    );
    expect(sql).toMatch(
      /grant select \(id, username, display_name, avatar_url, created_at\)\s+on table public\.profiles to authenticated/,
    );
    expect(sql).not.toMatch(/grant select \([^)]*\bbio\b/);
  });

  it("exposes bio only through profile_bio for the owner or an accepted friend", () => {
    expect(sql).toMatch(/function public\.profile_bio\(user_id uuid\)/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(/public\.is_friend\(\(select auth\.uid\(\)\), profile_bio\.user_id\)/);
    expect(sql).toMatch(/\(select auth\.uid\(\)\) = profile_bio\.user_id/);
    expect(sql).toMatch(/revoke all on function public\.profile_bio\(uuid\) from public/);
    expect(sql).toMatch(/revoke execute on function public\.profile_bio\(uuid\) from anon/);
    expect(sql).toMatch(/grant execute on function public\.profile_bio\(uuid\) to authenticated/);
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
});