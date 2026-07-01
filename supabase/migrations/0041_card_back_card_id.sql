-- Double-faced cards, v2: the back face becomes a REFERENCE to another card the
-- user owns, so it can be fully customised (its own colour, frame, rarity, art)
-- instead of the shared-frame `back_face` jsonb subset (migration 0015).
--
-- `back_card_id` mirrors `parent_card_id` (0003): a self-FK with ON DELETE SET
-- NULL, so deleting the referenced back card simply detaches it (the front card
-- survives, sans back) and deleting the front never touches the back card — it
-- stays a normal, standalone card in the owner's library.
--
-- The legacy `back_face` jsonb column is kept: the inline-layout frames
-- (Adventure / Split / Flip / Aftermath) and any pre-existing DFCs still render
-- from it. `back_card_id` takes precedence when both are set.

alter table public.cards
  add column if not exists back_card_id uuid references public.cards (id) on delete set null;

comment on column public.cards.back_card_id is
  'Optional FK to another owned card that serves as this card''s back face '
  '(v2 DFC — fully customisable). Precedence over the legacy back_face jsonb.';

-- Partial index for the (rare) reverse lookups "which cards use X as a back".
create index if not exists cards_back_card_id_idx
  on public.cards (back_card_id)
  where back_card_id is not null;
