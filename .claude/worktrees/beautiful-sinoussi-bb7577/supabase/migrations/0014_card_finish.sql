-- Phase 11 chunk 03 — premium card finishes.
--
-- This migration is **documentary only**. The `frame_style` column on
-- `public.cards` is a `jsonb` field with no per-key check constraint at
-- the database level — Postgres can't validate individual jsonb keys via
-- declarative CHECK without a custom function, and we've kept the
-- frame-style validation in the app layer (Zod) for flexibility.
--
-- What this migration does:
--   * Documents the new `finish` key in `frame_style`.
--   * Asserts the existing column is still jsonb (no schema change needed).
--
-- New finish vocabulary (validated in `lib/validation/card.ts`):
--   "regular"     — baseline frame, no overlay
--   "foil"        — animated holographic sheen
--   "etched"      — gold-leaf inner border + faint cross-hatch overlay
--   "borderless"  — art well bleeds behind the section panels
--   "showcase"    — italic display title with ornate underline
--
-- Existing rows without a `finish` key default to "regular" at the app
-- layer; no backfill needed.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cards'
      and column_name = 'frame_style'
      and data_type = 'jsonb'
  ) then
    raise exception 'Expected cards.frame_style to be jsonb';
  end if;
end $$;
