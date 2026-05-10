-- Phase 3 hardening — drop the broad SELECT policy on storage.objects for the
-- card-art bucket. Public buckets serve object URLs publicly without requiring
-- a SELECT policy; keeping the broad policy lets clients LIST all files, which
-- exposes more than intended.
--
-- See https://supabase.com/docs/guides/database/database-linter?lint=0025_public_bucket_allows_listing
--
-- This migration is a no-op on fresh databases applied from this repo because
-- 0004_card_art_storage.sql intentionally never creates the broad SELECT
-- policy. It is recorded here for parity with the live migration history.

drop policy if exists "Card art is publicly readable" on storage.objects;
