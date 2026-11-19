-- Read-only. Run on the hosted database BEFORE migration 018.
-- The first query lists decks that already use a precon id. Zero rows means those ids are free.
-- The second query counts decks whose owner_id is null. Expect 0 before 018.
-- SELECT only. No writes and no temporary tables.

select d.id, d.name, d.owner_id
from public.decks d
where d.id in (
  'a4313e99-e815-5163-b69d-d4201904719b'::uuid,
  'dd1a6355-982c-5246-9d88-906fb0722321'::uuid,
  'a82b1250-bcd0-5be4-b87e-20567b80036a'::uuid,
  'b3c89dad-6a35-583d-b8e8-eddf12c81036'::uuid,
  'b61bb1f2-6953-5cda-be27-50f6c2f7f47b'::uuid,
  '04a570a2-5cf9-5706-b2e5-065c2f9477dc'::uuid,
  '9b75777d-05c0-5f22-a380-c7d10d3b2e7b'::uuid,
  'fb7e70bc-834c-5b60-8ace-2a5c0452949c'::uuid,
  'dd4b5ec5-35bf-5311-87e1-d2d30dc09342'::uuid,
  '0f7e8637-11d9-507a-b42b-685bbd2a2006'::uuid,
  'a3bbebd0-c09d-53e2-8d0c-ca8afc460b5a'::uuid,
  '98cde813-f105-5d64-8004-84869f236012'::uuid,
  '026efaeb-ecce-5ecd-abcb-b8e662e63531'::uuid,
  'bc9fa7dd-56e5-50fe-9a6d-8c858e18902f'::uuid,
  'ec1f27bf-89c9-599b-8db8-0cc312e9304f'::uuid,
  'b4a57a03-ed41-5e3b-b8e8-94883fd8306b'::uuid,
  'ae3bc9cb-88d7-5942-a209-c7615eef7280'::uuid,
  '9755769c-41ae-5582-a477-ec89249d7cbe'::uuid,
  '842b9991-6e21-5230-968c-1f520cd1e289'::uuid,
  'e509d094-4b1f-5dc2-88aa-d671a551f1f4'::uuid,
  '208f2dfc-3c08-5536-ba96-46dbea2f4f35'::uuid,
  '2fed0531-4938-5daa-afd6-d7a89c774713'::uuid,
  '6065be11-0f99-5d5b-85d9-7f796d715a54'::uuid,
  '1b018570-34f3-5092-aee7-339e5d312eda'::uuid,
  'de78806c-1d56-53ff-91fb-579259a31928'::uuid,
  '1701d1b0-04da-5ec8-95b0-5c338a2b7486'::uuid,
  'e4ae5c63-8f80-5d64-a0e9-4298285a95f5'::uuid,
  'd3603d58-b3d7-5352-8b5e-5c937c050d82'::uuid,
  '0200a884-0256-531a-9528-dc335c72666b'::uuid,
  '4cceb30c-dd4f-574d-993d-f24eb77e91c7'::uuid,
  '6b53a61e-0fe3-5ea4-b820-c9dbdf9d934c'::uuid,
  '1a23b68f-6612-5ed1-bfb6-9de439e4a01c'::uuid,
  '4089a81e-7657-53fe-9020-0b8ddf35582b'::uuid,
  'e5eefc4b-e93c-5189-aeac-6c60354a7133'::uuid,
  '1751cb51-6bef-5eba-a2ba-d8e173b00120'::uuid,
  '3d4f0f62-2980-50f7-9eea-1b0380dac4c1'::uuid,
  '0f0f4f1e-84f4-5511-bb0a-0255e179e916'::uuid,
  '8901f24a-baec-5e70-932b-265bd4e110e0'::uuid,
  'a4b27e4b-df1d-56c8-8f82-83bff5613eaa'::uuid,
  '752f684b-e80e-50ec-bd2e-830949ff8cb8'::uuid,
  '82438815-e711-5f11-9ccd-6b8ad1c69b4c'::uuid,
  '5653507c-5035-55e5-b725-420cbb35eefd'::uuid,
  'ae1ec0e5-698a-5138-98f5-d4b0ac11885c'::uuid
)
order by d.id;

select count(*) filter (where owner_id is null) as null_owner_decks
from public.decks;
