-- 0207_saved_card_counts.sql — the home page's "cards forged" counts EVERY
-- saved card, not only the public ones.
--
-- The owner (2026-11-11): "on the home page it displays total cards forged
-- but I believe that number is … the total number of public cards not the
-- total number of all cards saved. That should be the number displayed."
-- It was: the page counted `cards` through the API as a signed-out visitor
-- (it is a static page that reads no cookie), and RLS shows a visitor only
-- the public and unlisted rows — the read then asked for the public ones.
-- A private card is a card somebody forged all the same.
--
-- saved_card_counts() returns ONE row of two numbers and nothing else:
--
--   cards            every card saved on the site now, whatever its
--                    visibility (public, unlisted, private) and whoever
--                    made it — except an admin's FRAME PREVIEW rows (0121
--                    `frame_preview`): those are the frame-verification
--                    tool's scratch cards, not cards anybody forged.
--   cards_this_week  the same cards, created in the last 7 days — the small
--                    print beside the total ("+N this week"), so the two
--                    numbers count the same thing.
--
-- No row, id, title or owner leaves the function: two totals. SECURITY
-- DEFINER with an empty search_path, because the caller is the anonymous
-- role and RLS would hide the private rows from its count.
--
-- Grants are explicit (0097): anon and authenticated may EXECUTE it (the
-- home page reads it with the cookie-free public client), and the service
-- role. Idempotent. Ships through a PR; never applied ad-hoc.

create or replace function public.saved_card_counts()
returns table (
  cards bigint,
  cards_this_week bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where c.created_at >= now() - interval '7 days')
  from public.cards c
  where c.frame_preview is not true;
$$;

comment on function public.saved_card_counts() is
  'The home page''s card totals (0207): every saved card whatever its visibility — an admin''s frame-preview rows left out — and how many of them were created in the last 7 days. Two numbers, no rows. Callable by anon and authenticated (the page is static and reads no cookie).';

revoke all on function public.saved_card_counts() from public;
grant execute on function public.saved_card_counts() to anon, authenticated, service_role;
