-- 0133 — the collector fields (TODO 4.9a, folding in 6.6): what a printing's
-- collector line says, stored as card data. Ships through a PR; never
-- applied ad-hoc.
--
-- MERGE ORDER: after 0132 (#433). Nothing here depends on 0130–0132's
-- contents — the numbers are what order them.
--
-- Three columns on public.cards (4.9 design 2026-09-29, final.md §3.1):
--
--   set_code          the PRINTED set code, upper-case, 2–6 letters or digits
--                     ("DMU"; a token or emblem set prints its PARENT: TDOM →
--                     "DOM"; PW23 prints "PRM"). NOT deck_cards.set_code,
--                     which holds Scryfall's own lower-case code (0055).
--   collector_number  1–12 of digits, letters, ★, †, "/" and "-": Scryfall's
--                     numbers as printed ("107", "237a", "H13", "XLN-117")
--                     and the 2015-style set size the import stores for a
--                     2015-era printing ("107/281", "1/16").
--   lang              the printing's language, every code Scryfall prints
--                     (18), NOT NULL default 'en'. Only twelve have a
--                     scan-verified printed code (es prints SP, ko prints
--                     KR); the six others (he, la, grc, ar, sa, qya) are
--                     stored and print nothing — never invented.
--
-- Nothing draws them yet (4.9b draws the collector line, opt-in per card;
-- no CARD_LAYOUT_VERSION bump, no sweep, no badge): 0 stored cards change.
-- The Scryfall import fills them from the printing (owner 2026-09-29:
-- imports follow the printing); the editor's "Set & collector info" step
-- edits them on any card. No backfill of the ~374 visible imported cards:
-- 0108's updated_at guard ignores only the render columns, so a bulk
-- UPDATE would churn the sitemap's lastmod and the OG cache-buster for no
-- visible change — the editor offers a per-card "Fill from the printing".
--
-- The zod schemas (lib/validation/card.ts) mirror the three CHECKs through
-- lib/cards/collector-fields.ts; tests/unit/db/card-collector-fields-
-- migration.test.ts holds the two to the same rules.
--
-- Adding a defaulted column fires no trigger and bumps no updated_at.
--
-- Grants: none. No new object — the columns are covered by 0097's
-- table-level grants on public.cards (anon / authenticated select; owner
-- writes through RLS); public.cards has no column-level grants.
--
-- Idempotent: `add column if not exists` for the columns, `drop constraint
-- if exists` + `add constraint` for the CHECKs.

alter table public.cards
  add column if not exists set_code text,
  add column if not exists collector_number text,
  add column if not exists lang text not null default 'en';

alter table public.cards
  drop constraint if exists cards_set_code_format,
  add constraint cards_set_code_format
    check (set_code is null or set_code ~ '^[A-Z0-9]{2,6}$');

alter table public.cards
  drop constraint if exists cards_collector_number_format,
  add constraint cards_collector_number_format
    check (collector_number is null
           or (char_length(collector_number) between 1 and 12
               and collector_number ~ '^[0-9A-Za-z★†/-]+$'));

alter table public.cards
  drop constraint if exists cards_lang_valid,
  add constraint cards_lang_valid
    check (lang in ('en','es','fr','de','it','pt','ja','ko','ru','zhs','zht','ph',
                    'he','la','grc','ar','sa','qya'));

comment on column public.cards.set_code is
  'The PRINTED set code (upper-case, 2-6 letters or digits; a token or emblem set prints its parent: TDOM -> DOM, PW23 -> PRM). Not deck_cards.set_code, which is Scryfall''s own lower-case code. TODO 4.9a.';
comment on column public.cards.collector_number is
  'The collector number as printed, with the 2015-style set size where the printing shows one ("107/281", "1/16"); 2023-style printings store the number alone. TODO 4.9a.';
comment on column public.cards.lang is
  'The printing''s language: one of Scryfall''s 18 codes (default en). Twelve have a printed code (es = SP, ko = KR); the other six print nothing. TODO 4.9a.';
