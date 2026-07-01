-- 0044_card_color_count.sql — a stored, generated color-count column so the
-- gallery can offer a real "Multicolor" filter (2+ colors) without an RPC.
--
-- color_identity is stored inconsistently for multicolor cards (individual
-- colors, occasionally a literal "multicolor" token). cardinality() gives the
-- element count, so `color_count > 1` matches the genuinely multicolor cards.
-- cardinality is immutable, which a STORED generated column requires.
--
-- Apply via `supabase db push` or the Supabase MCP.

alter table public.cards
  add column if not exists color_count integer
  generated always as (cardinality(color_identity)) stored;

comment on column public.cards.color_count is
  'Generated: number of entries in color_identity. >1 = multicolor (gallery filter).';

create index if not exists cards_color_count_idx
  on public.cards (color_count);
