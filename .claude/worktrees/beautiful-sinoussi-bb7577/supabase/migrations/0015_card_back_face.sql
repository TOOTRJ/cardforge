-- Phase 11 chunk 10 — double-faced card support.
-- Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP.
--
-- Adds an optional `back_face` jsonb column to `cards`. When set, the
-- card has a back face with its own title/cost/type/rules/art. When null
-- (the default), the card behaves exactly as before.
--
-- We use jsonb rather than a join table because:
--   - a card has at most one back face — no N:M relationship
--   - the back face is conceptually a "view" of the same card, not a
--     separate entity
--   - the front-card row already carries shared fields (rarity,
--     color_identity, frame_style) that apply to both faces, so the back
--     face only stores its per-face content
--
-- Field shape (validated in lib/validation/card.ts):
--   {
--     title, cost, card_type, supertype, subtypes, rules_text,
--     flavor_text, power, toughness, loyalty, defense, artist_credit,
--     art_url, art_position
--   }
--
-- Rarity, color_identity, and frame_style are NOT duplicated — the
-- shared front-card columns carry them.

alter table public.cards
  add column if not exists back_face jsonb;

comment on column public.cards.back_face is
  'Optional back-face data for double-faced cards (DFCs). When null, the card has only a front face.';
