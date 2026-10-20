-- Spellbranch local seed data (DEV ONLY)
--
-- Loaded by `supabase db reset` / `supabase start` (see [db.seed] in config.toml).
-- Never run this against a hosted/production project.
--
-- Test accounts (fake emails, dev-only password for all three):
--   alice@example.test / spellbranch-dev-only
--   bob@example.test   / spellbranch-dev-only
--   carol@example.test / spellbranch-dev-only
--
-- Users are inserted straight into auth.users + auth.identities (the usual
-- approach for local Supabase seeds); the on_auth_user_created trigger creates
-- the matching public.profiles rows from raw_user_meta_data.
--
-- Data:
--   alice <-> bob   accepted friends
--   carol -> alice  pending request
--   alice: public (forks on), friends-only, private, public (forks off)
--   bob:   fork of alice's public deck (set as alice's preferred branch)
--   carol: public deck

-- pgcrypto lives in the "extensions" schema on Supabase.
do $$
declare
  u record;
begin
  for u in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'alice@example.test', 'alice', 'Alice Arcanist'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'bob@example.test',   'bob',   'Bob the Brewer'),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'carol@example.test', 'carol', 'Carol Control')
    ) as t(id, email, username, display_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, extensions.crypt('spellbranch-dev-only', extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', u.username, 'display_name', u.display_name),
      now(), now(),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) values (
      u.id, u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      now(), now(), now()
    )
    on conflict do nothing;
  end loop;
end $$;

update public.profiles set bio = 'Izzet tempo enjoyer.' where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set bio = 'Forks everything.'    where id = '22222222-2222-4222-8222-222222222222';
update public.profiles set bio = 'Counterspell? Yes.'  where id = '33333333-3333-4333-8333-333333333333';

insert into public.friendships (id, requester_id, addressee_id, status) values
  ('f0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'accepted'),
  ('f0000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'pending')
on conflict do nothing;

insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, forked_from_id) values
  ('d0000000-0000-4000-8000-00000000a001', '11111111-1111-4111-8111-111111111111', 'Izzet Spells',       'modern',    'Public, forks allowed.',  'public',  true,  null),
  ('d0000000-0000-4000-8000-00000000a002', '11111111-1111-4111-8111-111111111111', 'Pod Night Commander', 'commander', 'Friends only.',          'friends', true,  null),
  ('d0000000-0000-4000-8000-00000000a003', '11111111-1111-4111-8111-111111111111', 'Secret Brew',         'casual',    'Private.',               'private', false, null),
  ('d0000000-0000-4000-8000-00000000a004', '11111111-1111-4111-8111-111111111111', 'Locked Pauper',       'pauper',    'Public, forks disabled.', 'public',  false, null),
  ('d0000000-0000-4000-8000-00000000c001', '33333333-3333-4333-8333-333333333333', 'Draw-Go',             'legacy',    'Public.',                'public',  true,  null)
on conflict (id) do nothing;

-- Bob's branch of Alice's public deck (public source -> friends-only branch, like forkDeckAction).
insert into public.decks (id, owner_id, name, format, notes, visibility, allow_forks, forked_from_id) values
  ('d0000000-0000-4000-8000-00000000b001', '22222222-2222-4222-8222-222222222222', 'Izzet Spells (branch)', 'modern', 'Public, forks allowed.', 'friends', true, 'd0000000-0000-4000-8000-00000000a001')
on conflict (id) do nothing;

update public.decks
  set preferred_branch_id = 'd0000000-0000-4000-8000-00000000b001'
  where id = 'd0000000-0000-4000-8000-00000000a001';

-- Cards (real Scryfall ids so images resolve).
with cards(scryfall_id, card_name, mana_cost, type_line, colors, image_uri, oracle_text) as (
  values
    ('7673784e-db4b-43a1-8d55-1bb9fc1e284f', 'Lightning Bolt',  '{R}',    'Instant',                 array['R'], 'https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg', 'Lightning Bolt deals 3 damage to any target.'),
    ('4f616706-ec97-4923-bb1e-11a69fbaa1f8', 'Counterspell',    '{U}{U}', 'Instant',                 array['U'], 'https://cards.scryfall.io/normal/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg', 'Counter target spell.'),
    ('bbc99a51-1501-4525-a3cc-f48249b64bed', 'Opt',             '{U}',    'Instant',                 array['U'], 'https://cards.scryfall.io/normal/front/b/b/bbc99a51-1501-4525-a3cc-f48249b64bed.jpg', 'Scry 1. Draw a card.'),
    ('22b36ad5-bf4d-436a-9c3c-fa4acd0052fe', 'Snapcaster Mage', '{1}{U}', 'Creature — Human Wizard', array['U'], 'https://cards.scryfall.io/normal/front/2/2/22b36ad5-bf4d-436a-9c3c-fa4acd0052fe.jpg', 'Flash'),
    ('1335d293-3dd2-4f13-bd2c-22181f4528ee', 'Island',          '',       'Basic Land — Island',     array[]::text[], 'https://cards.scryfall.io/normal/front/1/3/1335d293-3dd2-4f13-bd2c-22181f4528ee.jpg', '({T}: Add {U}.)'),
    ('85177bd7-6c50-48da-b692-ae5fe7bd357c', 'Mountain',        '',       'Basic Land — Mountain',   array[]::text[], 'https://cards.scryfall.io/normal/front/8/5/85177bd7-6c50-48da-b692-ae5fe7bd357c.jpg', '({T}: Add {R}.)'),
    ('8ee443cc-e17a-493b-9c93-1f9e141a30e4', 'Sol Ring',        '{1}',    'Artifact',                array[]::text[], 'https://cards.scryfall.io/normal/front/8/e/8ee443cc-e17a-493b-9c93-1f9e141a30e4.jpg', '{T}: Add {C}{C}.'),
    ('c6b6117c-faab-4bbb-b851-07bd8061ef03', 'Arcane Signet',   '{2}',    'Artifact',                array[]::text[], 'https://cards.scryfall.io/normal/front/c/6/c6b6117c-faab-4bbb-b851-07bd8061ef03.jpg', '{T}: Add one mana of any color in your commander''s color identity.'),
    ('1ac6cb62-45da-4e9a-84c6-09e6eacf0664', 'Command Tower',   '',       'Land',                    array[]::text[], 'https://cards.scryfall.io/normal/front/1/a/1ac6cb62-45da-4e9a-84c6-09e6eacf0664.jpg', '{T}: Add one mana of any color in your commander''s color identity.'),
    ('ec7d6864-7b6b-4f74-8474-9b9ec96b1d33', 'Brainstorm',      '{U}',    'Instant',                 array['U'], 'https://cards.scryfall.io/normal/front/e/c/ec7d6864-7b6b-4f74-8474-9b9ec96b1d33.jpg', 'Draw three cards, then put two cards from your hand on top of your library in any order.')
),
placements(deck_id, card_name, quantity) as (
  values
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Lightning Bolt', 4),
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Counterspell', 4),
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Opt', 4),
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Island', 10),
    ('d0000000-0000-4000-8000-00000000a001'::uuid, 'Mountain', 8),
    -- bob's branch: swapped Opt for Snapcaster, one more Mountain
    ('d0000000-0000-4000-8000-00000000b001'::uuid, 'Lightning Bolt', 4),
    ('d0000000-0000-4000-8000-00000000b001'::uuid, 'Counterspell', 4),
    ('d0000000-0000-4000-8000-00000000b001'::uuid, 'Snapcaster Mage', 4),
    ('d0000000-0000-4000-8000-00000000b001'::uuid, 'Island', 10),
    ('d0000000-0000-4000-8000-00000000b001'::uuid, 'Mountain', 9),
    ('d0000000-0000-4000-8000-00000000a002'::uuid, 'Sol Ring', 1),
    ('d0000000-0000-4000-8000-00000000a002'::uuid, 'Arcane Signet', 1),
    ('d0000000-0000-4000-8000-00000000a002'::uuid, 'Command Tower', 1),
    ('d0000000-0000-4000-8000-00000000a003'::uuid, 'Brainstorm', 4),
    ('d0000000-0000-4000-8000-00000000a004'::uuid, 'Lightning Bolt', 4),
    ('d0000000-0000-4000-8000-00000000a004'::uuid, 'Mountain', 16),
    ('d0000000-0000-4000-8000-00000000c001'::uuid, 'Counterspell', 4),
    ('d0000000-0000-4000-8000-00000000c001'::uuid, 'Brainstorm', 4),
    ('d0000000-0000-4000-8000-00000000c001'::uuid, 'Island', 18)
)
insert into public.deck_cards (deck_id, scryfall_id, card_name, image_uri, mana_cost, type_line, colors, oracle_text, quantity)
select p.deck_id, c.scryfall_id, c.card_name, c.image_uri, nullif(c.mana_cost, ''), c.type_line, c.colors, c.oracle_text, p.quantity
from placements p join cards c using (card_name)
on conflict (deck_id, scryfall_id) do nothing;

insert into public.comments (deck_id, author_id, body) values
  ('d0000000-0000-4000-8000-00000000a001', '22222222-2222-4222-8222-222222222222', 'Snapcaster over Opt? See my branch.'),
  ('d0000000-0000-4000-8000-00000000a001', '33333333-3333-4333-8333-333333333333', 'Needs more counterspells.'),
  ('d0000000-0000-4000-8000-00000000b001', '11111111-1111-4111-8111-111111111111', 'Marked this as my preferred branch.');

insert into public.favorite_cards (user_id, scryfall_id, card_name, image_uri, mana_cost, type_line) values
  ('11111111-1111-4111-8111-111111111111', '7673784e-db4b-43a1-8d55-1bb9fc1e284f', 'Lightning Bolt', 'https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg', '{R}', 'Instant'),
  ('22222222-2222-4222-8222-222222222222', '22b36ad5-bf4d-436a-9c3c-fa4acd0052fe', 'Snapcaster Mage', 'https://cards.scryfall.io/normal/front/2/2/22b36ad5-bf4d-436a-9c3c-fa4acd0052fe.jpg', '{1}{U}', 'Creature — Human Wizard'),
  ('33333333-3333-4333-8333-333333333333', '4f616706-ec97-4923-bb1e-11a69fbaa1f8', 'Counterspell', 'https://cards.scryfall.io/normal/front/4/f/4f616706-ec97-4923-bb1e-11a69fbaa1f8.jpg', '{U}{U}', 'Instant')
on conflict (user_id, scryfall_id) do nothing;
