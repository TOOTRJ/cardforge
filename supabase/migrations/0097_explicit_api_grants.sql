-- 0097_explicit_api_grants.sql — the Data API privileges this schema needs,
-- stated explicitly instead of inherited from the age of the Supabase project.
--
-- WHY. Production is an older Supabase project. There, anything `postgres`
-- creates in `public` is granted to the API roles automatically (its
-- pg_default_acl hands anon / authenticated / service_role ALL on tables and
-- EXECUTE on functions). Migrations 0001–0096 lean on that without saying so:
-- almost none of them contain a GRANT.
--
-- NEW Supabase projects no longer do this — and every preview branch, and the
-- persistent `dev` branch, IS a new project. Built from the same migrations,
-- their API roles get no SELECT/INSERT/UPDATE/DELETE on any table and no
-- EXECUTE on any function. The schema is all there and PostgREST answers
-- "permission denied for table cards" (42501) to everyone, service_role
-- included. A branch's "Supabase Preview" check still goes green, because the
-- migrations themselves succeed — which is why this went unnoticed.
--
-- WHAT. Every statement below is a GRANT, generated on 2026-09-21 from
-- PRODUCTION'S OWN ACLs (aclexplode over pg_class.relacl, pg_attribute.attacl
-- and pg_proc.proacl for the three API roles + PUBLIC). Consequences:
--
--   * On production it is a no-op by construction — it re-grants exactly what
--     is already granted. It contains no REVOKE, so there is no moment at
--     which production has fewer privileges than it does now.
--   * On a fresh database it supplies precisely what was missing, and nothing
--     more: the deliberate lockdowns are preserved because they are simply
--     never granted here —
--       - profiles: no table-level SELECT for anon/authenticated, only the
--         public COLUMNS (0074 — billing + is_admin stay unreadable);
--       - email_preferences / newsletter_deliveries: service_role, plus the
--         narrow authenticated grants from 0095;
--       - notifications: authenticated cannot DELETE (0088);
--       - claim_job_step / patch_job_step / grant_credits / the admin + email
--         RPCs: service_role only (0073, 0060, 0095);
--       - get_my_billing / consume_credits: never anon.
--
-- DO NOT "simplify" this into `grant all on all tables in schema public` —
-- that would silently undo every lockdown in the list above.
--
-- GOING FORWARD the default privileges are aligned too (last section), so a
-- migration behaves the same on production, on a branch and on the local
-- stack. New tables and functions should still state their grants explicitly.

-- Schema -------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Tables: full privileges (RLS is the gate) ----------------------------------
grant delete, insert, maintain, references, select, trigger, truncate, update
  on table
  public.ai_generation_jobs, public.card_ai_calls, public.card_comments,
  public.card_exports, public.card_idea_batches, public.card_likes,
  public.card_reports, public.card_set_items, public.card_sets,
  public.card_templates, public.cards, public.challenges,
  public.comment_reports, public.credit_ledger, public.custom_pips,
  public.deck_cards, public.deck_guides, public.deck_idea_batches,
  public.deck_likes, public.decks, public.email_preferences,
  public.featured_cards, public.feedback, public.follows,
  public.frame_profile_overrides, public.frame_reviews, public.game_systems,
  public.message_threads, public.messages, public.newsletter_deliveries,
  public.notifications, public.profiles, public.scryfall_calls,
  public.set_likes, public.site_settings, public.site_update_acks,
  public.site_updates, public.stripe_events
  to service_role;

grant delete, insert, maintain, references, select, trigger, truncate, update
  on table
  public.ai_generation_jobs, public.card_ai_calls, public.card_comments,
  public.card_exports, public.card_idea_batches, public.card_likes,
  public.card_reports, public.card_set_items, public.card_sets,
  public.card_templates, public.cards, public.challenges,
  public.comment_reports, public.credit_ledger, public.custom_pips,
  public.deck_cards, public.deck_guides, public.deck_idea_batches,
  public.deck_likes, public.decks, public.featured_cards, public.feedback,
  public.follows, public.frame_profile_overrides, public.frame_reviews,
  public.game_systems, public.message_threads, public.messages,
  public.notifications, public.scryfall_calls, public.set_likes,
  public.site_settings, public.site_update_acks, public.site_updates,
  public.stripe_events
  to anon;

grant delete, insert, maintain, references, select, trigger, truncate, update
  on table
  public.ai_generation_jobs, public.card_ai_calls, public.card_comments,
  public.card_exports, public.card_idea_batches, public.card_likes,
  public.card_reports, public.card_set_items, public.card_sets,
  public.card_templates, public.cards, public.challenges,
  public.comment_reports, public.credit_ledger, public.custom_pips,
  public.deck_cards, public.deck_guides, public.deck_idea_batches,
  public.deck_likes, public.decks, public.featured_cards, public.feedback,
  public.follows, public.frame_profile_overrides, public.frame_reviews,
  public.game_systems, public.message_threads, public.messages,
  public.scryfall_calls, public.set_likes, public.site_settings,
  public.site_update_acks, public.site_updates, public.stripe_events
  to authenticated;

-- Tables: deliberately narrower ----------------------------------------------
-- notifications: everything except DELETE (0088 — rows are cleared, not deleted).
grant insert, maintain, references, select, trigger, truncate, update
  on table public.notifications
  to authenticated;

-- profiles: NO table-level SELECT for the public roles (0074). What they may
-- read is the column list below; billing columns and is_admin are not on it.
grant delete, insert, maintain, references, trigger, truncate, update
  on table public.profiles
  to anon, authenticated;

grant select
  (id, username, display_name, avatar_url, bio, website_url, created_at,
   updated_at, banner_url, accent_color, twitter_url, bluesky_url, instagram_url,
   youtube_url, tiktok_url, discord_url, github_url, pinned_card_ids, featured_at,
   export_watermark_text, onboarded_at)
  on table public.profiles
  to anon, authenticated;

-- email_preferences (0095): users read their row and flip three switches.
grant select on table public.email_preferences to authenticated;

grant update (account_emails, activity_emails, newsletter)
  on table public.email_preferences
  to authenticated;

-- Functions: service_role only (triggers, admin + credit + email RPCs) --------
grant execute on function
  public.admin_list_users(text,text,text,text,text,integer,integer),
  public.admin_user_stats(uuid),
  public.assign_default_profile_media(),
  public.claim_job_step(uuid,text),
  public.create_email_preferences(),
  public.email_recipients(text,uuid[]),
  public.generate_username(),
  public.grant_credits(uuid,integer,text,text),
  public.guard_profile_username(),
  public.handle_new_user(),
  public.notify_admins_on_card_report(),
  public.notify_admins_on_comment_report(),
  public.notify_admins_on_feedback(),
  public.notify_on_card_comment(),
  public.notify_on_card_like(),
  public.notify_on_card_remix(),
  public.notify_on_follow(),
  public.on_message_posted(),
  public.patch_job_step(uuid,text,jsonb),
  public.random_default_avatar(),
  public.random_default_banner(),
  public.record_signup_credit_grant(),
  public.scryfall_usage_admin_daily(timestamp with time zone),
  public.scryfall_usage_admin_top_users(timestamp with time zone,integer),
  public.suppress_email(text,text),
  public.touch_email_preferences()
  to service_role;

-- Functions: PUBLIC (trigger functions + view/rank counters created before the
-- project's function defaults were tightened) ---------------------------------
grant execute on function
  public.card_like_rank_in_set(uuid,uuid),
  public.card_like_rank(uuid),
  public.cards_search_vector_refresh(),
  public.increment_card_view(uuid),
  public.protect_billing_columns(),
  public.set_ai_generation_jobs_updated_at(),
  public.set_card_comments_updated_at(),
  public.set_card_sets_updated_at(),
  public.set_cards_updated_at(),
  public.set_custom_pips_updated_at(),
  public.set_decks_updated_at(),
  public.set_profiles_updated_at(),
  public.sync_card_likes_count(),
  public.sync_deck_likes_count()
  to public, anon, authenticated, service_role;

-- Functions: the API roles, signed in or not ----------------------------------
grant execute on function
  public.card_ai_calls_daily(timestamp with time zone),
  public.increment_card_share(uuid),
  public.increment_deck_view(uuid),
  public.is_reserved_username(text),
  public.list_gallery_cards(text,text,text,text,text,text,boolean,text,text,integer,integer,boolean),
  public.list_trending_pool(integer),
  public.owner_export_stamp(uuid),
  public.owner_is_admin(uuid),
  public.scryfall_calls_daily(timestamp with time zone),
  public.viewer_is_admin()
  to anon, authenticated, service_role;

-- Functions: signed-in users only ---------------------------------------------
grant execute on function
  public.consume_credits(integer,text,text),
  public.credit_ledger_daily(timestamp with time zone),
  public.get_my_billing(),
  public.mark_message_thread_read(uuid)
  to authenticated, service_role;

-- Default privileges: what production already has -----------------------------
-- (No-op there. On a new project this replaces the restrictive defaults so the
-- NEXT migration's tables and functions are reachable everywhere, not only on
-- production. Applies to objects created by `postgres`, the role every
-- migration runs as.)
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
