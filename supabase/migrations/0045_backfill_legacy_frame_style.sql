-- 0045_backfill_legacy_frame_style.sql — repair cards created before the frame
-- picker (Phase: MSE frames).
--
-- Those rows carry the retired frame_style shape {accent, border, finish} with
-- NO template, so the renderer falls back to the default m15 frame — visibly
-- wrong for lands (a land renders on the creature frame instead of m15land).
-- The accent/border keys are dead data the current renderer ignores.
--
-- This backfills the correct m15-era template from card_type, strips the dead
-- keys, and nulls layout_version on the rows whose frame actually changes
-- (lands/tokens/planeswalkers/battles) so scripts/rebake-renders.mjs
-- regenerates their gallery PNG. finish is left untouched (all stored values
-- are valid CardFinish members). No rows are deleted.
--
-- Apply via `supabase db push` or the Supabase MCP, then run the re-bake sweep.

-- 1. Backfill template on legacy (null-template) rows + flag frame-changed
--    rows for re-bake.
update public.cards
set
  frame_style = (frame_style - 'accent' - 'border')
    || jsonb_build_object(
      'template',
      case card_type
        when 'land' then 'm15land'
        when 'token' then 'm15token'
        when 'planeswalker' then 'm15pw'
        when 'battle' then 'battle'
        else 'm15'
      end
    ),
  layout_version = case
    when card_type in ('land', 'token', 'planeswalker', 'battle')
      then null
    else layout_version
  end
where frame_style ->> 'template' is null;

-- 2. Strip the dead accent/border keys from any already-templated rows that
--    still carry them (no render change — the renderer ignores these keys).
update public.cards
set frame_style = frame_style - 'accent' - 'border'
where frame_style ? 'accent' or frame_style ? 'border';
