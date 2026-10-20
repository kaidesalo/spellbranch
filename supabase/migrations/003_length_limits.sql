-- Spellbranch 003: database limit on profiles.bio (Cipher, PR #2 review N1).
--
-- The app caps bios at 280 characters, but a signed-in user can PATCH their
-- own profile row through the API directly (RLS allows self-update), so the
-- database enforces the same limit. Safe to re-run.
-- If this fails with a check violation, some existing bio is longer than 280
-- characters: shorten it first.

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (char_length(bio) <= 280);
