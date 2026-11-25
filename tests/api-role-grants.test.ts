import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("migration 020 api role grants", () => {
  const sql = read("supabase/migrations/020_api_role_grants.sql");

  it("is a re-runnable transaction that only grants", () => {
    const statements = sql.replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/^begin;/m);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(statements).not.toMatch(/\brevoke\b/i);
    expect(statements).not.toMatch(/\b(create|drop|alter)\s+policy\b/i);
    expect(statements).not.toMatch(/\b(insert|update|delete)\s+into\b/i);
  });

  it("gives authenticated select on friendships and comments, and not anon", () => {
    expect(sql).toMatch(
      /grant select, insert, delete on table public\.friendships to authenticated;/,
    );
    expect(sql).toMatch(/grant update \(status\) on table public\.friendships to authenticated;/);
    expect(sql).toMatch(/grant select, insert, delete on table public\.comments to authenticated;/);
    expect(sql).toMatch(/grant select on table public\.comments to anon;/);
    expect(sql).not.toMatch(/friendships to anon/i);
    expect(sql).not.toMatch(/favorite_cards to anon/i);
    expect(sql).not.toMatch(/grant update on table public\.comments/i);
  });

  it("does not restore table select on profiles or decks", () => {
    expect(sql).not.toMatch(/grant select on table public\.profiles/i);
    expect(sql).not.toMatch(/grant select on table public\.decks/i);
    expect(sql).toMatch(/grant insert, update, delete on table public\.profiles to authenticated;/);
    expect(sql).toMatch(/grant insert, update, delete on table public\.decks to authenticated;/);
  });

  it("keeps the policy helpers executable", () => {
    expect(sql).toMatch(
      /grant execute on function public\.is_friend\(uuid, uuid\) to anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.can_view_deck\(public\.decks, uuid\) to anon, authenticated;/,
    );
  });
});

describe("grants preflight check", () => {
  const sql = read("supabase/checks/grants_preflight.sql");

  it("is a single read-only select", () => {
    const body = sql.replace(/--[^\n]*/g, "");
    expect(body.match(/;/g)).toHaveLength(1);
    expect(body.trimEnd().endsWith(";")).toBe(true);
    expect(body).not.toMatch(/^\s*(insert|update|delete|grant|revoke|alter|drop|create|truncate)\b/im);
    expect(body).toMatch(/\bselect\b/i);
  });

  it("expects the login-breaking privileges and the 016 revokes", () => {
    expect(sql).toContain("('authenticated', 'friendships',         'table', 'SELECT', true)");
    expect(sql).toContain("('anon',          'friendships',         'table', 'SELECT', false)");
    expect(sql).toContain("('authenticated', 'comments',            'table', 'SELECT', true)");
    expect(sql).toContain("('authenticated', 'comments',            'table', 'UPDATE', false)");
    expect(sql).toContain("('authenticated', 'profiles', 'bio',           'SELECT', false)");
    expect(sql).toContain("('authenticated', 'decks', 'copied_from_id', 'SELECT', false)");
  });
});
