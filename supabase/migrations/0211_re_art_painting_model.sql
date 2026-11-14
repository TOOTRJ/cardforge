-- 0211_re_art_painting_model.sql — Re-art deck (beta tool `re-art-deck`,
-- 0191): WHICH model painted a card.
--
-- A run can now name the gateway model that paints it (the studio's model
-- picker, for testing — lib/tools/re-art/model.ts REART_MODELS; one credit
-- a picture on any of them). A tester comparing models has to see, on each
-- card, who painted it: until now that was known only to the run's own job
-- step, which is not kept with the card.
--
-- deck_reart_cards gains `image_model`: the gateway model that painted the
-- picture(s) Re-art put on the card last — one id ("bfl/flux-2-pro"), or two
-- joined by " + " when a two-faced card's faces were painted by different
-- models (the default model's backup can paint one of them). NULL: painted
-- before this migration, or not known. Written by the server with the rest
-- of the row; the table's grants are table-level (0191), so they cover the
-- column.
--
-- No stored card changes and nothing is charged for. Idempotent. Ships
-- through a PR; never applied ad-hoc.

alter table public.deck_reart_cards
  add column if not exists image_model text;

alter table public.deck_reart_cards
  drop constraint if exists deck_reart_cards_image_model_check;
alter table public.deck_reart_cards
  add constraint deck_reart_cards_image_model_check
  check (image_model is null or char_length(image_model) between 1 and 200);

comment on column public.deck_reart_cards.image_model is
  'Re-art deck (0211): the gateway model that painted the picture(s) Re-art put on the card last — one id, or two joined by " + " for a two-faced card painted by two models. NULL: painted before 0211, or not known.';
