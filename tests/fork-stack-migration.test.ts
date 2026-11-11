import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve(__dirname, "../supabase/migrations/010_fork_stack_and_copy.sql"),
  "utf8",
);

function sliceBetween(start: string, end: string): string {
  const from = sql.indexOf(start);
  const to = sql.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return sql.slice(from, to);
}

describe("migration 010", () => {
  it("walks nested forks to the root without deleting rows or creating self-links", () => {
    const backfill = sliceBetween("3. Backfill", "4. Shared fork/copy");
    expect(backfill).toMatch(/while updated > 0 and guard < 32/);
    expect(backfill).toMatch(/parent\.forked_from_id <> child\.id/);
    expect(backfill).toMatch(/set forked_from_id = parent\.forked_from_id/);
    expect(backfill).not.toMatch(/delete from/i);
    expect(backfill).toMatch(/preferred_branch_id = null/);
    expect(backfill).toMatch(/still point at another branch/);
  });

  it("keeps fork permission on the deck being forked and flattens in the trigger", () => {
    const trigger = sliceBetween("function public.enforce_deck_links()", "3. Backfill");
    expect(trigger).toMatch(/src\.owner_id = caller or \(src\.allow_forks and public\.can_view_deck/);
    expect(trigger).toMatch(/new\.forked_from_id := root/);
    expect(trigger).toMatch(/You are not allowed to fork this deck/);
    expect(trigger).toMatch(/The original deck does not allow forks/);
    expect(trigger).toMatch(/spellbranch_root_forks_locked/);
    expect(trigger).not.toMatch(/select \* into/);
    const fork = sliceBetween("function public.fork_deck(source uuid)", "function public.copy_deck");
    expect(fork).toMatch(/security invoker/);
    expect(fork).not.toMatch(/security definer/);
    expect(fork).toMatch(/coalesce\(color_identity/);
    expect(fork).toMatch(/lock_visible_deck\(source\)/);
    expect(fork).not.toMatch(/for share/);
    expect(trigger).toMatch(/enforce_fork_copy_rate\(\)/);
    expect(fork).toMatch(/left\(src\.name, 80 - char_length\(' \(branch\)'\)\)/);
    expect(trigger).toMatch(/lock_visible_deck/);
    expect(trigger).not.toMatch(/for share/);
    // The insert names the deck the caller forked. The trigger rewrites it.
    expect(fork).toMatch(/src\.id/);
  });

  it("hides copied_from_id from API roles and returns it only when both decks are visible", () => {
    expect(sql).toMatch(/revoke select on table public\.decks from public, anon, authenticated/);
    expect(sql).toMatch(/grant select \(/);
    const grant = sliceBetween("grant select (", ") on table public.decks to anon, authenticated");
    expect(grant).not.toMatch(/copied_from_id/);
    expect(grant).toMatch(/\bid\b/);
    expect(grant).toMatch(/\bcolors\b/);
    const link = sliceBetween("function public.copy_source_link(target uuid)", "revoke select on table");
    expect(link).toMatch(/security definer/);
    expect(link).toMatch(/set search_path = ''/);
    expect(link).toMatch(/not public\.can_view_deck\(deck, viewer\)/);
    expect(link).toMatch(/public\.can_view_deck\(src, viewer\)/);
    expect(link).toMatch(/return query select null::uuid, false/);
    expect(link).not.toMatch(/return query select null::uuid, true/);
    expect(sql).toMatch(/function public\.lock_visible_deck\(target uuid\)/);
    expect(sql).toMatch(/for share;/);
    expect(sql).toMatch(/function public\.enforce_fork_copy_rate\(\)/);
    expect(sql).toMatch(/private\.rate_limit_hit_core\('db:fork_or_copy:uid:'/);
    expect(sql).toMatch(/revoke all on function public\.enforce_fork_copy_rate\(\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.copy_source_link\(uuid\) to anon, authenticated/);
    expect(sql).toMatch(/function public\.copy_links_for_deck\(target uuid\)/);
    expect(sql).toMatch(/revoke execute on function public\.copy_links_for_deck\(uuid\) from public, anon/);
    expect(sql).toMatch(/viewer = deck\.owner_id or viewer = other\.owner_id/);
    expect(sql).toMatch(/revoke execute on function public\.copy_deck\(uuid\) from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.copy_deck\(uuid\) to authenticated/);
  });

  it("does not change the deck-name length constraint, and shortens the copy default", () => {
    expect(sql).not.toMatch(/decks_name_length/);
    expect(sql).toMatch(/left\(src\.name, 80 - char_length\(' \(copy\)'\)\)/);
    expect(sql).toMatch(/left\(src\.name, 80 - char_length\(' \(branch\)'\)\)/);
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/Re-run 010 after any re-run of 002/);
  });
});
