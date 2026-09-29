-- 0121 — admin frame previews and per-template sign-off (frames plan
-- Phase 2: TODO 2.3 and 2.4).
--
-- 1. cards.frame_preview. An admin can walk the creator on a frame/colour
--    that isn't verified yet (?previewFrames=…, TODO 2.1/2.2) and save the
--    result, so the frame is checked through every step exactly as a user
--    would make the card. Such a card is a FRAME PREVIEW: flagged here,
--    always private, and listed under its template in /admin/frame-compare
--    with delete / re-verify. The app decides who may save one
--    (createCardAction / updateCardAction check is_admin on the server);
--    the database backs it twice:
--      * cards_frame_preview_private (CHECK): a flagged card is private, so
--        every surface that reads public / unlisted cards — the gallery,
--        the sitemap, the hubs, trending, feeds, profiles, OG images — can
--        never show one, whatever a later code path does. Bulk "make
--        public" on one fails loudly instead of leaking it.
--      * cards_guard_frame_preview (trigger): an API session may raise the
--        flag only when viewer_is_admin(). The table-level grants from 0097
--        let any owner update their own row, so without this a user could
--        flag a card and put it into the admin's list. The service role
--        and the migration/seed owner are not API sessions and pass.
--    Default false: every existing row stays an ordinary card; nothing is
--    rewritten, updated_at does not move (a column added with a constant
--    default is a catalog change, and cards_set_updated_at fires on UPDATE
--    only), so no card is re-baked or badged.
--
-- 2. frame_review_events gains two actions for the per-template sign-off
--    (2.4):
--      * 'score'   — an admin scored one colour against its reference
--                    (layout version, override hash, reference, score). The
--                    sign-off reads the newest one per colour.
--      * 'signoff' — the owner published a whole template (color_key '*',
--                    the per-colour scores in score_json). Each colour it
--                    publishes also gets its own 'verify' row, as a tick
--                    does, so the per-colour history stays complete.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- 1. The flag -----------------------------------------------------------------

alter table public.cards
  add column if not exists frame_preview boolean not null default false;

comment on column public.cards.frame_preview is
  'An admin''s frame preview (TODO 2.3): saved on a frame/colour while walking the creator in preview mode. Always private (cards_frame_preview_private); only admins may set it (cards_guard_frame_preview).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_frame_preview_private'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_frame_preview_private
      check (not frame_preview or visibility = 'private');
  end if;
end;
$$;

-- The admin checklist lists previews by template; a partial index keeps the
-- read to the handful of flagged rows.
create index if not exists cards_frame_preview_template_idx
  on public.cards ((frame_style ->> 'template'))
  where frame_preview;

-- Only an admin's API session may raise the flag. SECURITY INVOKER on
-- purpose: current_user is then the caller's role (anon / authenticated for
-- PostgREST, service_role for the admin client, the owner for migrations and
-- seeds), which is what the check needs. viewer_is_admin() (0080) is
-- SECURITY DEFINER and executable by anon and authenticated.
create or replace function public.guard_card_frame_preview()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.frame_preview
     and (tg_op = 'INSERT' or not old.frame_preview)
     and current_user in ('anon', 'authenticated')
     and not public.viewer_is_admin() then
    raise exception 'frame_preview_admin_only: only an admin can save a frame preview'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists cards_guard_frame_preview on public.cards;
create trigger cards_guard_frame_preview
  before insert or update of frame_preview on public.cards
  for each row execute function public.guard_card_frame_preview();

-- 2. Sign-off events ------------------------------------------------------------

alter table public.frame_review_events
  drop constraint if exists frame_review_events_action_check;
alter table public.frame_review_events
  add constraint frame_review_events_action_check check (
    action in (
      'verify', 'withdraw', 'pin', 'unpin', 'override_saved', 'override_reset',
      'score', 'signoff'
    )
  );

-- Grants (every migration states them — new projects don't auto-grant).
-- * cards: the new column is covered by the table-level privileges 0097
--   states for anon / authenticated / service_role (RLS is the gate there;
--   the trigger above is the gate for this column). Nothing new is granted.
-- * frame_review_events: unchanged — service role only (0115); the admin
--   actions write through it after their own is_admin check.
-- * The trigger function fires for every role's writes regardless of
--   EXECUTE; no API role may call it directly.
revoke all on function public.guard_card_frame_preview() from public, anon, authenticated;
