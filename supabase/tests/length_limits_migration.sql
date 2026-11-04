-- Spellbranch: migration 003 on existing over-limit data (Cipher PR #3 review
-- L3, re-review N1). Runs 003 itself twice (psql \ir, like pg_prove/psql) on
-- rows written before 003, including a planted row that collided with the
-- old 'invalid-' || md5(...) rename. Self-contained; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

-- Back to the pre-003 state: none of 003's constraints.
alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.decks drop constraint if exists decks_name_length;
alter table public.decks drop constraint if exists decks_notes_length;
alter table public.deck_cards drop constraint if exists deck_cards_text_lengths;
alter table public.deck_cards drop constraint if exists deck_cards_colors_valid;
alter table public.favorite_cards drop constraint if exists favorite_cards_text_lengths;

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
 ('d9000000-0000-4000-8000-000000000001','authenticated','authenticated','mig1@example.test','{"username":"mig_ann"}');

-- What a user could write through the API before 003 (their own rows, RLS on).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d9000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.decks (id, owner_id, name, format, visibility, notes) values
 ('d9100000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001', repeat('n', 150), 'modern', 'private', repeat('x', 5000));
insert into public.deck_cards (deck_id, scryfall_id, card_name, type_line, quantity, oracle_text, colors, color_identity) values
 -- over-long id: can never be a real card
 ('d9100000-0000-4000-8000-000000000001', repeat('L', 65), 'long id', 't', 1, null, '{}', '{}'),
 -- planted row whose id is exactly what the old migration renamed L to
 ('d9100000-0000-4000-8000-000000000001', 'invalid-' || md5(repeat('L', 65)), 'planted', 't', 1, null, '{}', '{}'),
 -- a normal card with over-limit text
 ('d9100000-0000-4000-8000-000000000001', 'ok-id', repeat('c', 300), 't', 1, repeat('o', 5000), array['G','X','W','G'], '{}');
insert into public.favorite_cards (user_id, scryfall_id, card_name) values
 ('d9000000-0000-4000-8000-000000000001', repeat('F', 65), 'long id'),
 ('d9000000-0000-4000-8000-000000000001', 'invalid-' || md5(repeat('F', 65)), 'planted'),
 ('d9000000-0000-4000-8000-000000000001', 'ok-fav', repeat('c', 300));
reset role;

-- Apply 003, twice.
\ir ../migrations/003_length_limits.sql
\ir ../migrations/003_length_limits.sql

select ok(exists (select 1 from pg_constraint where conname = c and convalidated),
          format('%s is back and validated after applying 003 twice', c))
  from unnest(array['profiles_bio_length','decks_name_length','decks_notes_length',
                    'deck_cards_text_lengths','deck_cards_colors_valid',
                    'favorite_cards_text_lengths']) as c;
select has_function('public', 'restart_friend_request', array['uuid'], 'restart_friend_request exists');

select is((select count(*) from public.deck_cards where char_length(scryfall_id) > 64), 0::bigint,
  'deck_cards rows with an over-long scryfall_id were deleted');
select is((select count(*) from public.favorite_cards where char_length(scryfall_id) > 64), 0::bigint,
  'favorite_cards rows with an over-long scryfall_id were deleted');
select is((select card_name from public.deck_cards where scryfall_id = 'invalid-' || md5(repeat('L', 65))), 'planted',
  'the planted deck_cards row is untouched (it didn''t block the migration)');
select is((select card_name from public.favorite_cards where scryfall_id = 'invalid-' || md5(repeat('F', 65))), 'planted',
  'the planted favorite_cards row is untouched (it didn''t block the migration)');
select is((select count(*) from public.deck_cards where deck_id = 'd9100000-0000-4000-8000-000000000001'), 2::bigint,
  'the deck keeps its other two cards');
select is((select char_length(card_name) || '/' || char_length(oracle_text) || '/' || colors::text
             from public.deck_cards where scryfall_id = 'ok-id'), '200/4000/{W,G}',
  'over-limit card text is trimmed and colors normalized');
select is((select char_length(card_name) from public.favorite_cards where scryfall_id = 'ok-fav'), 200,
  'over-limit favorite name is trimmed');
select is((select char_length(name) || '/' || char_length(notes) from public.decks
             where id = 'd9100000-0000-4000-8000-000000000001'), '80/2000',
  'over-limit deck name and notes are trimmed');
select is((select count(*) from public.decks where id = 'd9100000-0000-4000-8000-000000000001'), 1::bigint,
  'the deck itself is kept');

select * from finish();
rollback;
