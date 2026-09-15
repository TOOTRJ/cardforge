-- 0074_profiles_billing_columns.sql — billing + admin columns are no longer
-- world-readable.
--
-- profiles has a `using (true)` SELECT policy (0001) because usernames,
-- avatars and bios are public. But the same policy exposed every billing
-- column — Stripe customer/subscription ids, credit balances, subscription
-- status, admin comps, the is_admin flag — to the anon key and to every
-- signed-in user via plain PostgREST. RLS is row-level; the fix is
-- column-level: replace the blanket table grant with an explicit grant on
-- the public columns only, and hand the two legitimate readers of the
-- private columns a SECURITY DEFINER function each:
--
--   * get_my_billing()           — the signed-in user's OWN billing slice
--                                  (getCurrentProfile merges it back in).
--   * owner_export_stamp(owner)  — the one fact public renders need about
--                                  a card's owner: does their plan remove
--                                  the brand mark, and what footer mark
--                                  did they set. Returns booleans/text,
--                                  never the underlying columns.
--
-- The service role is unaffected (webhook, cron, admin pages). Writes are
-- unchanged: users still UPDATE their own profile row and the
-- protect_billing_columns trigger keeps reverting billing fields.

-- 1. Column-level SELECT --------------------------------------------------
revoke select on public.profiles from anon, authenticated;
grant select (
  id, username, display_name, avatar_url, bio, website_url,
  created_at, updated_at, banner_url, accent_color,
  twitter_url, bluesky_url, instagram_url, youtube_url, tiktok_url,
  discord_url, github_url, pinned_card_ids, featured_at,
  export_watermark_text
) on public.profiles to anon, authenticated;

-- 2. The user's own billing slice ----------------------------------------
create or replace function public.get_my_billing()
returns table (
  subscription_tier text,
  subscription_status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  credits integer,
  comp_tier text,
  comp_expires_at timestamptz,
  card_limit_override integer,
  is_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.subscription_tier, p.subscription_status, p.stripe_customer_id,
    p.stripe_subscription_id, p.current_period_end, p.cancel_at_period_end,
    p.credits, p.comp_tier, p.comp_expires_at, p.card_limit_override,
    p.is_admin
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated;

-- 3. What a card owner's plan stamps on public renders --------------------
-- Mirrors lib/billing/entitlements.ts effectiveTierForProfile: a paid tier
-- counts while active/trialing, an unexpired admin comp counts, admins are
-- always unlocked. `paid` = the brand mark is removed and the custom footer
-- is honoured. Billing-off deployments ignore the result in app code.
create or replace function public.owner_export_stamp(p_owner_id uuid)
returns table (paid boolean, footer_text text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(p.is_admin, false)
      or (p.subscription_tier in ('plus', 'pro')
          and p.subscription_status in ('active', 'trialing'))
      or (p.comp_tier in ('plus', 'pro')
          and (p.comp_expires_at is null or p.comp_expires_at > now()))
      as paid,
    nullif(btrim(p.export_watermark_text), '') as footer_text
  from public.profiles p
  where p.id = p_owner_id;
$$;

revoke all on function public.owner_export_stamp(uuid) from public, anon, authenticated;
grant execute on function public.owner_export_stamp(uuid) to anon, authenticated;
