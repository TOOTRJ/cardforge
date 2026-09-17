-- 0090_card_footer_text.sql — per-card footer mark for subscribers.
--
-- The custom footer line paid users print on their downloads was one
-- profile-wide setting (profiles.export_watermark_text, migration 0063). The
-- creator's new Subscriber step lets them set it PER CARD (owner decision
-- 2026-09-17), with the profile value as the default for new cards.
--
--   NULL  → legacy row: downloads fall back to the profile default.
--   ''    → explicitly no footer mark on this card.
--   text  → this card's own footer mark (≤ 40 chars, same as the profile).
--
-- Display surfaces (bake, gallery, OG) never print it — only a paid
-- viewer's download does (watermark policy, layout v20).

alter table public.cards
  add column if not exists footer_text text
  check (char_length(footer_text) <= 40);
