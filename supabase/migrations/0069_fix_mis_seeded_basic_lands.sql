-- 0069_fix_mis_seeded_basic_lands.sql — nonbasic lands that carried the
-- creator's basic-land seed and printed a big mana symbol instead of their
-- rules text.
--
-- Picking the Land kind seeds a card as a basic ("Basic" supertype + the
-- frame color's land type). Until the 2026-09 creator fix, renaming the card
-- (Command Tower) or importing a real land that carries no supertype /
-- subtypes of its own (Adarkar Wastes) left the seed in place, and the
-- renderers — keyed on the seed's subtype — hid the rules text
-- (feedback 2026-09-14: "All land cards default to no text").
--
-- Repair: for every land with the Basic supertype, non-empty rules text and
-- a title that is not a basic's name, drop "Basic" from the supertype and a
-- seeded "Wastes" subtype (Wastes has no land type in the rules; a real
-- basic land type such as Mountain is kept — the user may have meant it).
-- The stored render is cleared so the gallery falls back to the live
-- preview immediately and the next rebake sweep (/api/admin/rebake, or the
-- owner's next save) bakes the corrected card.

with victims as (
  select id
  from public.cards
  where card_type = 'land'
    and coalesce(supertype, '') ~* '\mbasic\M'
    and coalesce(btrim(rules_text), '') <> ''
    and lower(btrim(title)) not in (
      'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
      'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
      'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
    )
)
update public.cards c
set
  supertype = nullif(
    btrim(regexp_replace(c.supertype, '\mbasic\M\s*', '', 'gi')),
    ''
  ),
  subtypes = case
    when lower(array_to_string(c.subtypes, ',')) = 'wastes' then '{}'::text[]
    else c.subtypes
  end,
  rendered_image_url = null,
  rendered_at = null,
  layout_version = null
from victims v
where c.id = v.id;
