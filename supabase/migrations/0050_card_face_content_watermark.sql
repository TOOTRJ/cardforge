-- Structured kind-specific text content + per-card design watermark.
--
-- face_content: loyalty ability rows / saga chapters as data
--   {"v":1, "loyalty":{"abilities":[{"cost":"+1","text":"…"}]},
--          "saga":{"intro":"…","chapters":[{"numerals":[1,2],"text":"…"}]}}
--   NULL = legacy card; renderers fall back to parsing rules_text, and the
--   editor dual-writes face_content + a canonically serialized rules_text on
--   save (lib/cards/face-content.ts owns the round-trip), so search/AI/
--   diffing keep working off rules_text.
--
-- watermark: the faint mark behind the rules text
--   {"kind":"mana"|"preset"|"custom", "key"?, "url"?, "opacity"?, "size"?}
--   NULL = none (default). Validated app-side (lib/validation/card.ts),
--   like back_face — no CHECK constraints.
--
-- FRONT face only by design: inline second faces (adventure/flip/split/
-- aftermath halves) never render loyalty/chapter rails or watermarks; a v2
-- linked back card is a full cards row and gets both columns for free.
--
-- No RLS changes: both columns ride the existing per-row cards policies.

alter table public.cards
  add column if not exists face_content jsonb;

comment on column public.cards.face_content is
  'Structured kind-specific content {v, loyalty?, saga?}. NULL = derive from rules_text.';

alter table public.cards
  add column if not exists watermark jsonb;

comment on column public.cards.watermark is
  'Card-design watermark {kind, key?, url?, opacity?, size?}. NULL = none.';
